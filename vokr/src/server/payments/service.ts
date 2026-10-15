import { CheckoutPaymentMethod, CheckoutState, PaymentStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { CheckoutStaleError, ConflictError, ReservationExpiredError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { findOwnedSession } from "@/server/checkout/service";
import { assertValidCheckoutTransition } from "@/server/checkout/state-machine";
import { prisma } from "@/server/db/client";
import type { PricingSnapshot } from "@/server/pricing";

import { RazorpayApiError, type RazorpayClient, type RazorpayOrder } from "./razorpay";

/** Everything the browser needs to open Razorpay Checkout — and nothing it could use to change the amount. */
export interface PaymentOrderView {
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
}

export interface PaymentStatusView {
  checkoutSessionId: string;
  checkoutState: CheckoutState;
  paymentStatus: PaymentStatus | null;
  /** Set once the session is paid and its order exists (plan §5 Phase 9). */
  orderNumber: string | null;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** A conditional `update` whose `where` no longer matches (P2025) means another request already made the same change. */
async function ignoreNoMatch(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    throw error;
  }
}

const PAYMENT_SELECT = {
  id: true,
  providerOrderId: true,
  amountPaise: true,
  currency: true,
  status: true,
} as const;

/**
 * The idempotency claim (plan §5 Phase 7, tasks 3–4). One `payments` row per
 * checkout session, enforced by `UNIQUE(checkout_session_id)`: the first
 * caller inserts it, every concurrent or later caller gets the same row
 * back. Written *before* Razorpay is called, so an order can never exist at
 * Razorpay without a local record.
 */
async function claimPayment(checkoutSessionId: string, amountPaise: number) {
  try {
    return await prisma.payment.create({
      data: { checkoutSessionId, amountPaise },
      select: PAYMENT_SELECT,
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    return prisma.payment.findUniqueOrThrow({
      where: { checkoutSessionId },
      select: PAYMENT_SELECT,
    });
  }
}

/** A concurrent request may win the create between our lookup and ours; if Razorpay refuses the duplicate receipt, the winner's order is the answer. */
async function findOrCreateOrder(
  razorpay: RazorpayClient,
  input: Parameters<RazorpayClient["createOrder"]>[0],
): Promise<RazorpayOrder> {
  const found = await razorpay.findOrderByReceipt(input.receipt);
  if (found) return found;
  try {
    return await razorpay.createOrder(input);
  } catch (error) {
    if (error instanceof RazorpayApiError && error.status === 400) {
      const raceWinner = await razorpay.findOrderByReceipt(input.receipt);
      if (raceWinner) return raceWinner;
    }
    throw error;
  }
}

function assertOrderMatches(order: RazorpayOrder, amountPaise: number, receipt: string): void {
  if (order.amount !== amountPaise || order.currency !== "INR" || order.receipt !== receipt) {
    throw new Error(
      `Razorpay order ${order.id} does not match the claim (amount ${order.amount}/${amountPaise}, receipt ${order.receipt}/${receipt}).`,
    );
  }
}

/**
 * Creates — or returns the already-created — Razorpay order for a
 * reserved checkout session.
 *
 * - The amount comes **only** from `pricing_snapshot.totalPaise` (task 2);
 *   the request carries no amount, and none is accepted.
 * - The session must be `reserved` (Phase 8 owns that step) or already
 *   `payment_pending` (a retry), with a prepaid snapshot.
 * - `receipt` is the checkout session ID: unique per session and inside
 *   Razorpay's 40-character limit (the session's own idempotency key can be
 *   up to 200 characters, so it cannot be sent as-is).
 * - The Razorpay call happens outside any transaction or row lock (R9). If
 *   a previous attempt claimed the row but never stored an order ID (it
 *   crashed, or a concurrent request is in flight), Razorpay is asked for an
 *   existing order with this receipt before a new one is created, and only
 *   the first writer's order ID is ever stored (`provider_order_id IS NULL`
 *   guard), so the browser is only ever given one order to pay.
 */
export async function createPaymentOrder(
  identity: Identity,
  checkoutSessionId: string,
  razorpay: RazorpayClient,
  now: Date = new Date(),
): Promise<PaymentOrderView> {
  const session = await findOwnedSession(identity, checkoutSessionId);

  if (session.state !== CheckoutState.reserved && session.state !== CheckoutState.payment_pending) {
    throw new ConflictError(`Checkout session cannot take payment from state "${session.state}".`);
  }
  if (session.paymentMethod !== CheckoutPaymentMethod.prepaid) {
    throw new ValidationError("This checkout session is not set up for online payment.");
  }
  const snapshot = session.pricingSnapshot as PricingSnapshot | null;
  if (!snapshot || !session.expiresAt) {
    throw new ConflictError("Checkout session has no pricing snapshot.");
  }
  // The same bag already paid through another session (another tab): no
  // order, new or existing, is handed out for it. A payment already open in
  // that tab is caught when it lands (`applyPaymentObservation`).
  const bagPaid = await prisma.checkoutSession.count({
    where: { cartId: session.cartId, state: CheckoutState.paid, id: { not: checkoutSessionId } },
  });
  if (bagPaid > 0) {
    throw new CheckoutStaleError("This bag has already been paid for in another window.");
  }

  const existing = await prisma.payment.findUnique({
    where: { checkoutSessionId },
    select: PAYMENT_SELECT,
  });
  // From `reserved` on, `expires_at` is the stock hold's expiry (Phase 8).
  // Past it, the browser is never given an order to pay — not even the
  // existing one: the maintenance job may release the stock at any moment
  // after, and a payment started now could be captured for stock no longer
  // held. A payment already in flight is unaffected; it is the hold that
  // the job keeps while Razorpay reports the attempt unfinished.
  const holdLapsed = session.expiresAt.getTime() <= now.getTime();
  if (existing?.providerOrderId) {
    if (holdLapsed) {
      throw new ReservationExpiredError("Your reservation has lapsed. Please start checkout again.");
    }
    return toOrderView(existing.id, existing.providerOrderId, existing);
  }

  // A new Razorpay order is only created against a live hold. In these
  // states `expires_at` is the hold's expiry, so this is a lapsed
  // reservation, not stale pricing.
  if (holdLapsed) {
    throw new ReservationExpiredError("Your reservation has lapsed. Please start checkout again.");
  }

  const payment = existing ?? (await claimPayment(checkoutSessionId, snapshot.totalPaise));
  if (payment.providerOrderId) {
    return toOrderView(payment.id, payment.providerOrderId, payment);
  }

  const receipt = checkoutSessionId;
  const order = await findOrCreateOrder(razorpay, {
    amountPaise: payment.amountPaise,
    receipt,
    notes: { checkout_session_id: checkoutSessionId, payment_id: payment.id },
  });
  assertOrderMatches(order, payment.amountPaise, receipt);

  // First writer wins; a concurrent request that lost keeps the stored ID.
  await ignoreNoMatch(
    prisma.payment.update({
      where: { id: payment.id, AND: { providerOrderId: null } },
      data: { providerOrderId: order.id },
      select: { id: true },
    }),
  );

  if (session.state === CheckoutState.reserved) {
    assertValidCheckoutTransition(
      checkoutSessionId,
      CheckoutState.reserved,
      CheckoutState.payment_pending,
    );
    await ignoreNoMatch(
      prisma.checkoutSession.update({
        where: { id: checkoutSessionId, state: CheckoutState.reserved },
        data: { state: CheckoutState.payment_pending },
        select: { id: true },
      }),
    );
  }

  // The stock hold may have lapsed while Razorpay was being called: the
  // maintenance job then moved the session to `expired` and released the
  // stock, and the conditional update above matched nothing. The order must
  // not reach the browser, or the customer could pay for stock no longer held.
  const after = await prisma.checkoutSession.findUniqueOrThrow({
    where: { id: checkoutSessionId },
    select: { state: true },
  });
  if (after.state !== CheckoutState.payment_pending && after.state !== CheckoutState.paid) {
    console.warn(
      `[payments] payment=${payment.id} session=${checkoutSessionId} is "${after.state}" after order creation — order withheld`,
    );
    throw new ReservationExpiredError("Your reservation has lapsed. Please start checkout again.");
  }

  const stored = await prisma.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: PAYMENT_SELECT,
  });
  console.info(
    `[payments] payment=${stored.id} razorpay_order=${stored.providerOrderId} amount=${stored.amountPaise} session=${checkoutSessionId}`,
  );
  return toOrderView(stored.id, stored.providerOrderId as string, stored);
}

function toOrderView(
  paymentId: string,
  razorpayOrderId: string,
  payment: { amountPaise: number; currency: string; status: PaymentStatus },
): PaymentOrderView {
  return {
    paymentId,
    razorpayOrderId,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    status: payment.status,
  };
}

/**
 * Read-only status for the browser to poll after Razorpay Checkout closes.
 * The Checkout success handler is untrusted input (task 5): whatever it
 * claims, this only reports what verified webhooks (or reconciliation)
 * have recorded. "Pending" is shown as pending.
 */
export async function getPaymentStatus(
  identity: Identity,
  checkoutSessionId: string,
): Promise<PaymentStatusView> {
  const session = await findOwnedSession(identity, checkoutSessionId);
  const payment = await prisma.payment.findUnique({
    where: { checkoutSessionId },
    select: { status: true },
  });
  const order =
    session.state === CheckoutState.paid
      ? await prisma.order.findUnique({ where: { checkoutSessionId }, select: { orderNumber: true } })
      : null;
  return {
    checkoutSessionId,
    checkoutState: session.state,
    paymentStatus: payment?.status ?? null,
    orderNumber: order?.orderNumber ?? null,
  };
}
