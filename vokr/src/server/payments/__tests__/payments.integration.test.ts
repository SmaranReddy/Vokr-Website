import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { CheckoutState, PaymentIssueState, PaymentStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import { pruneExpiredRows } from "@/server/jobs/prune";

import { RazorpayApiError, type RazorpayClient, type RazorpayOrder, type RazorpayPayment } from "../razorpay";
import { applyOrderAttempts, reconcilePendingPayments, RECONCILE_AFTER_MS } from "../reconcile";
import { createPaymentOrder, getPaymentStatus } from "../service";
import { handleRazorpayWebhook } from "../webhook";

/**
 * Plan §5 Phase 7, Testing Requirements — against a real Postgres, with
 * Razorpay replaced by an in-memory fake (no test-mode credentials exist
 * yet; see the Phase 7 Status). Sessions reach `reserved` through the real
 * Phase 8 reservation, so a capture commits a real stock hold.
 */

const WEBHOOK_SECRET = "whsec_integration_fixture";
const AMOUNT = 999_500;

const fixtures = newCheckoutFixtures();
const createdEventIds: string[] = [];

/** Behaves like Razorpay where it matters: `receipt` is unique, and orders are looked up by it. */
class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  readonly payments = new Map<string, RazorpayPayment[]>();
  createCalls = 0;

  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    this.createCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if ([...this.orders.values()].some((order) => order.receipt === input.receipt)) {
      throw new RazorpayApiError(400, "receipt already exists");
    }
    const order = {
      id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      status: "created",
    };
    this.orders.set(order.id, order);
    return order;
  }

  async findOrderByReceipt(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt) ?? null;
  }

  async listOrderPayments(orderId: string) {
    return this.payments.get(orderId) ?? [];
  }
}

async function reservedSession(
  overrides: { paymentMethod?: "prepaid" | "cod"; expiresAt?: Date; state?: CheckoutState } = {},
): Promise<{ identity: Identity; sessionId: string; variantId: string }> {
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: [{ variantId, quantity: 1 }],
    totalPaise: AMOUNT,
    paymentMethod: overrides.paymentMethod ?? "prepaid",
  });
  if (overrides.state === CheckoutState.priced) return { identity, sessionId, variantId };

  await reserveCheckoutSession(identity, sessionId);
  if (overrides.state || overrides.expiresAt) {
    await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { state: overrides.state, expiresAt: overrides.expiresAt },
      select: { id: true },
    });
  }
  return { identity, sessionId, variantId };
}

function paymentEvent(
  type: string,
  orderId: string,
  overrides: {
    paymentId?: string;
    amount?: number;
    status?: string;
    /** Adds a refund entity for `refund.*` events. */
    refund?: { amount?: number; status?: string };
  } = {},
) {
  const paymentId = overrides.paymentId ?? "pay_attempt_1";
  return JSON.stringify({
    entity: "event",
    event: type,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      ...(overrides.refund
        ? {
            refund: {
              entity: {
                id: `rfnd_${paymentId}`,
                payment_id: paymentId,
                amount: overrides.refund.amount ?? overrides.amount ?? AMOUNT,
                status: overrides.refund.status ?? "processed",
              },
            },
          }
        : {}),
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: overrides.amount ?? AMOUNT,
          currency: "INR",
          status: overrides.status ?? type.replace("payment.", ""),
          email: "customer@example.com",
          contact: "+919876543210",
          vpa: "customer@okbank",
        },
      },
    },
  });
}

async function deliver(rawBody: string, eventId = `evt_${randomUUID()}`, secret = WEBHOOK_SECRET) {
  createdEventIds.push(eventId);
  return handleRazorpayWebhook({
    rawBody,
    signature: createHmac("sha256", secret).update(rawBody).digest("hex"),
    eventId,
    secret: WEBHOOK_SECRET,
  });
}

async function paymentFor(sessionId: string) {
  return prisma.payment.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: { status: true, providerPaymentId: true, providerOrderId: true, amountPaise: true },
  });
}

async function stateOf(sessionId: string) {
  return (
    await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { state: true },
    })
  ).state;
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, createdEventIds);
  createdEventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createPaymentOrder (plan §5 Phase 7, tasks 2–4)", () => {
  it("creates one Razorpay order for the snapshot total and moves the session to payment_pending", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();

    const order = await createPaymentOrder(identity, sessionId, razorpay);

    expect(order.amountPaise).toBe(AMOUNT);
    expect(razorpay.orders.get(order.razorpayOrderId)?.amount).toBe(AMOUNT);
    expect(razorpay.orders.get(order.razorpayOrderId)?.receipt).toBe(sessionId);
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
    expect((await paymentFor(sessionId)).providerOrderId).toBe(order.razorpayOrderId);
  });

  it("the same session never creates two Razorpay orders — sequential retries", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();

    const first = await createPaymentOrder(identity, sessionId, razorpay);
    const second = await createPaymentOrder(identity, sessionId, razorpay);

    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(razorpay.createCalls).toBe(1);
    expect(razorpay.orders.size).toBe(1);
  });

  it("the same session never creates two Razorpay orders — eight concurrent requests", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => createPaymentOrder(identity, sessionId, razorpay)),
    );

    expect(new Set(results.map((result) => result.razorpayOrderId)).size).toBe(1);
    expect(razorpay.orders.size).toBe(1);
    expect(await prisma.payment.count({ where: { checkoutSessionId: sessionId } })).toBe(1);
  });

  it("recovers a claim whose Razorpay order was created but never stored (crash between call and write)", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    await prisma.payment.create({ data: { checkoutSessionId: sessionId, amountPaise: AMOUNT } });
    const orphan = await razorpay.createOrder({ amountPaise: AMOUNT, receipt: sessionId });

    const order = await createPaymentOrder(identity, sessionId, razorpay);

    expect(order.razorpayOrderId).toBe(orphan.id);
    expect(razorpay.orders.size).toBe(1);
  });

  it("refuses a session that is not reserved", async () => {
    const { identity, sessionId } = await reservedSession({ state: CheckoutState.priced });
    await expect(createPaymentOrder(identity, sessionId, new FakeRazorpay())).rejects.toThrow(
      ConflictError,
    );
  });

  it("refuses a COD session", async () => {
    const { identity, sessionId } = await reservedSession({ paymentMethod: "cod" });
    await expect(createPaymentOrder(identity, sessionId, new FakeRazorpay())).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuses to create an order against an expired snapshot", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession({ expiresAt: new Date(Date.now() - 1000) });
    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(ConflictError);
    expect(razorpay.createCalls).toBe(0);
  });

  it("another identity's session is a 404", async () => {
    const { sessionId } = await reservedSession();
    const { identity: other } = await reservedSession();
    await expect(createPaymentOrder(other, sessionId, new FakeRazorpay())).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("Razorpay webhook (plan §5 Phase 7, tasks 6–9)", () => {
  async function pendingOrder() {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const order = await createPaymentOrder(identity, sessionId, razorpay);
    return { identity, sessionId, orderId: order.razorpayOrderId, razorpay };
  }

  it("payment.captured marks the payment captured and the session paid", async () => {
    const { sessionId, orderId } = await pendingOrder();

    const result = await deliver(paymentEvent("payment.captured", orderId));

    expect(result.status).toBe(200);
    expect(await paymentFor(sessionId)).toMatchObject({
      status: PaymentStatus.captured,
      providerPaymentId: "pay_attempt_1",
    });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
  });

  it("the same webhook delivered five times produces exactly one state change", async () => {
    const { sessionId, orderId } = await pendingOrder();
    const body = paymentEvent("payment.captured", orderId);
    const eventId = `evt_${randomUUID()}`;

    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await deliver(body, eventId));

    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((result) => result.body.duplicate)).toHaveLength(4);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: eventId } })).toBe(1);
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.captured);
  });

  it("concurrent duplicate deliveries are still processed once", async () => {
    const { orderId } = await pendingOrder();
    const body = paymentEvent("payment.captured", orderId);
    const eventId = `evt_${randomUUID()}`;

    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(body, eventId)));

    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(results.filter((result) => !result.body.duplicate)).toHaveLength(1);
  });

  it("out-of-order delivery (captured before authorized) converges on captured", async () => {
    const { sessionId, orderId } = await pendingOrder();

    await deliver(paymentEvent("payment.captured", orderId));
    await deliver(paymentEvent("payment.authorized", orderId));

    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.captured);
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
  });

  it("concurrent captured + authorized for the same order converge on captured", async () => {
    const { sessionId, orderId } = await pendingOrder();

    await Promise.all([
      deliver(paymentEvent("payment.authorized", orderId)),
      deliver(paymentEvent("payment.captured", orderId)),
    ]);

    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.captured);
  });

  it("a failed first attempt followed by a captured retry ends paid; a late failure cannot undo it", async () => {
    const { sessionId, orderId } = await pendingOrder();

    await deliver(paymentEvent("payment.failed", orderId, { paymentId: "pay_a1" }));
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.failed);
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);

    await deliver(paymentEvent("payment.captured", orderId, { paymentId: "pay_a2" }));
    await deliver(paymentEvent("payment.failed", orderId, { paymentId: "pay_a1" }));

    expect(await paymentFor(sessionId)).toMatchObject({
      status: PaymentStatus.captured,
      providerPaymentId: "pay_a2",
    });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
  });

  it("a capture for a different amount is stored but never marks the order paid", async () => {
    const { sessionId, orderId } = await pendingOrder();
    const eventId = `evt_${randomUUID()}`;

    const result = await deliver(paymentEvent("payment.captured", orderId, { amount: 100 }), eventId);

    expect(result.status).toBe(200);
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.created);
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
    const stored = await prisma.webhookEvent.findFirstOrThrow({ where: { providerEventId: eventId } });
    expect(stored.processingError).toMatch(/amount mismatch/);
  });

  it("money captured for the wrong amount gets one durable issue in manual review, for what Razorpay holds", async () => {
    const { sessionId, orderId } = await pendingOrder();
    const mismatch = paymentEvent("payment.captured", orderId, { paymentId: "pay_mismatch", amount: 100 });

    await deliver(mismatch);
    await deliver(mismatch);

    const issues = await prisma.paymentIssue.findMany({
      where: { payment: { checkoutSessionId: sessionId } },
      select: { state: true, reason: true, providerPaymentId: true, amountPaise: true, lastError: true },
    });
    expect(issues).toEqual([
      {
        state: PaymentIssueState.manual_review,
        reason: "amount_mismatch",
        providerPaymentId: "pay_mismatch",
        amountPaise: 100,
        lastError: expect.stringMatching(/amount mismatch/),
      },
    ]);
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.created);
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("a failed attempt for the wrong amount opens no issue: no money moved", async () => {
    const { sessionId, orderId } = await pendingOrder();
    await deliver(paymentEvent("payment.failed", orderId, { amount: 100 }));
    expect(await prisma.paymentIssue.count({ where: { payment: { checkoutSessionId: sessionId } } })).toBe(0);
  });

  it("a capture on an order this server never created is kept durably and refunded by no one", async () => {
    const eventId = `evt_${randomUUID()}`;
    const result = await deliver(paymentEvent("payment.captured", "order_NotOurs000001"), eventId);

    expect(result.status).toBe(200);
    const stored = await prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: eventId },
      select: { processingError: true },
    });
    expect(stored.processingError).toMatch(/no local payment for order order_NotOurs000001/);

    // Past the 90-day retention it is still kept; a clean event is not.
    const cleanId = `evt_${randomUUID()}`;
    await deliver(JSON.stringify({ event: "payment.dispute.created", payload: {} }), cleanId);
    await prisma.$executeRaw`
      UPDATE webhook_events SET received_at = now() - interval '91 days'
       WHERE provider_event_id IN (${eventId}, ${cleanId})
    `;
    await pruneExpiredRows();
    expect(await prisma.webhookEvent.count({ where: { providerEventId: eventId } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: cleanId } })).toBe(0);
  });

  it("an invalid signature is refused, stores nothing and changes nothing", async () => {
    const { sessionId, orderId } = await pendingOrder();
    const eventId = `evt_${randomUUID()}`;

    const result = await deliver(paymentEvent("payment.captured", orderId), eventId, "forged_secret");

    expect(result.status).toBe(400);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: eventId } })).toBe(0);
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.created);
  });

  it("refuses every delivery when no webhook secret is configured", async () => {
    const result = await handleRazorpayWebhook({
      rawBody: "{}",
      signature: createHmac("sha256", "").update("{}").digest("hex"),
      eventId: "evt_x",
      secret: undefined,
    });
    expect(result.status).toBe(503);
  });

  it("an unknown event type is stored and acknowledged, never rejected", async () => {
    const eventId = `evt_${randomUUID()}`;
    const result = await deliver(JSON.stringify({ event: "payment.dispute.created", payload: {} }), eventId);
    expect(result.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: eventId } })).toBe(1);
  });

  it("stores no customer contact, email or UPI handle", async () => {
    const { orderId } = await pendingOrder();
    const eventId = `evt_${randomUUID()}`;
    await deliver(paymentEvent("payment.captured", orderId), eventId);

    const stored = await prisma.webhookEvent.findFirstOrThrow({ where: { providerEventId: eventId } });
    const serialised = JSON.stringify(stored.payload);
    expect(serialised).not.toContain("customer@example.com");
    expect(serialised).not.toContain("+919876543210");
    expect(serialised).not.toContain("okbank");
  });

  it("refund.processed with a processed refund entity for the whole amount moves a captured payment to refunded", async () => {
    const { sessionId, orderId } = await pendingOrder();
    await deliver(paymentEvent("payment.captured", orderId));
    await deliver(paymentEvent("refund.processed", orderId, { status: "refunded", refund: {} }));
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.refunded);
  });

  it.each([
    ["a payment summary that says refunded, with no refund entity", {}],
    ["a partial refund", { refund: { amount: 100 } }],
    ["a refund that is still pending", { refund: { status: "pending" } }],
  ])("refund.processed with %s leaves the payment captured", async (_label, extra) => {
    const { sessionId, orderId } = await pendingOrder();
    await deliver(paymentEvent("payment.captured", orderId));
    await deliver(paymentEvent("refund.processed", orderId, { status: "refunded", ...extra }));
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.captured);
  });
});

describe("forged browser callback (plan §5 Phase 7, Security)", () => {
  it("a fabricated payment ID and signature from the browser change nothing", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    await createPaymentOrder(identity, sessionId, razorpay);

    // There is no endpoint that accepts the Checkout handler's
    // razorpay_payment_id / razorpay_signature. The only browser-facing
    // payment reads are order creation (idempotent) and status (read-only):
    // call both as an attacker would after a "success" callback.
    await createPaymentOrder(identity, sessionId, razorpay);
    const status = await getPaymentStatus(identity, sessionId);

    expect(status).toEqual({
      checkoutSessionId: sessionId,
      checkoutState: CheckoutState.payment_pending,
      paymentStatus: PaymentStatus.created,
    });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("a webhook signed with anything but the webhook secret cannot mark the order paid", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);

    // The browser-visible key ID is not a signing secret.
    await deliver(paymentEvent("payment.captured", razorpayOrderId), undefined, "rzp_test_public_key");

    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });
});

describe("reconcilePendingPayments (plan §5 Phase 7, task 10)", () => {
  it("resolves a session whose webhook never arrived", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
    razorpay.payments.set(razorpayOrderId, [
      { id: "pay_failed", order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "failed" },
      { id: "pay_ok", order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" },
    ]);

    const later = new Date(Date.now() + RECONCILE_AFTER_MS + 1000);
    const result = await reconcilePendingPayments(razorpay, later);

    expect(result.outcomes.some((outcome) => outcome.kind === "applied")).toBe(true);
    expect(await paymentFor(sessionId)).toMatchObject({
      status: PaymentStatus.captured,
      providerPaymentId: "pay_ok",
    });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
  });

  it("leaves sessions younger than 30 minutes alone", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
    razorpay.payments.set(razorpayOrderId, [
      { id: "pay_ok", order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" },
    ]);

    await reconcilePendingPayments(razorpay, new Date());

    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("one order Razorpay cannot read is counted and skipped; every other order is still reconciled", async () => {
    const razorpay = new FakeRazorpay();
    // Created first, so it heads the batch.
    const poisoned = await reservedSession();
    const { razorpayOrderId: poisonedOrder } = await createPaymentOrder(poisoned.identity, poisoned.sessionId, razorpay);
    const healthy = await reservedSession();
    const { razorpayOrderId: healthyOrder } = await createPaymentOrder(healthy.identity, healthy.sessionId, razorpay);
    razorpay.payments.set(healthyOrder, [
      { id: "pay_ok", order_id: healthyOrder, amount: AMOUNT, currency: "INR", status: "captured" },
    ]);
    const list = razorpay.listOrderPayments.bind(razorpay);
    razorpay.listOrderPayments = async (orderId: string) => {
      if (orderId === poisonedOrder) throw new RazorpayApiError(502, "Bad gateway");
      return list(orderId);
    };

    const result = await reconcilePendingPayments(razorpay, new Date(Date.now() + RECONCILE_AFTER_MS + 1000));

    expect(result.errors).toBe(1);
    expect(await stateOf(healthy.sessionId)).toBe(CheckoutState.paid);
    expect(await stateOf(poisoned.sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("a `refunded` payment summary is never applied: it moves nothing and closes nothing", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
    await deliver(paymentEvent("payment.captured", razorpayOrderId, { paymentId: "pay_ok" }));
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);

    const outcome = await applyOrderAttempts(razorpayOrderId, [
      { id: "pay_ok", order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "refunded" },
    ]);

    expect(outcome).toBeNull();
    expect((await paymentFor(sessionId)).status).toBe(PaymentStatus.captured);
  });
});
