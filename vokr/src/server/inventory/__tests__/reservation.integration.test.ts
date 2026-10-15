import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { CheckoutState, PaymentStatus, ReservationState } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";
import { addItem } from "@/server/cart";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { createCheckoutSession, priceCheckoutSession, setCheckoutAddress } from "@/server/checkout/service";
import { prisma } from "@/server/db/client";
import { expireReservations, PAYMENT_GRACE_MINUTES } from "@/server/jobs/expire-reservations";
import { runMaintenance } from "@/server/jobs/maintenance";
import { pruneExpiredRows } from "@/server/jobs/prune";
import type { RazorpayClient, RazorpayOrder, RazorpayPayment } from "@/server/payments/razorpay";
import { RECONCILE_AFTER_MS } from "@/server/payments/reconcile";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { InsufficientStockError, MAX_HELD_UNITS_PER_IDENTITY_PER_VARIANT } from "../holds";
import {
  cleanupCheckoutFixtures,
  guest,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
  stockOf,
} from "./checkout-fixtures";

/**
 * Plan §5 Phase 8, Testing Requirements and Validation, against a real
 * Postgres. Razorpay is an in-memory fake (no test-mode credentials exist;
 * nothing here makes a network call).
 */

const AMOUNT = 999_500;
const WEBHOOK_SECRET = "whsec_phase8_fixture";

const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  readonly payments = new Map<string, RazorpayPayment[]>();
  /** Runs inside `createOrder`, i.e. while the order is being created and no lock is held. */
  duringCreate: (() => Promise<void>) | null = null;
  listCalls = 0;

  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    if (this.duringCreate) await this.duringCreate();
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
    this.listCalls += 1;
    return this.payments.get(orderId) ?? [];
  }

  attempt(orderId: string, id: string, status: string, amount = AMOUNT) {
    const list = this.payments.get(orderId) ?? [];
    list.push({ id, order_id: orderId, amount, currency: "INR", status } as RazorpayPayment);
    this.payments.set(orderId, list);
  }
}

function webhookBody(type: string, orderId: string, paymentId: string, amount = AMOUNT) {
  return JSON.stringify({
    entity: "event",
    event: type,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount,
          currency: "INR",
          status: type.replace("payment.", ""),
        },
      },
    },
  });
}

async function deliver(type: string, orderId: string, paymentId = "pay_attempt_1", amount = AMOUNT) {
  const rawBody = webhookBody(type, orderId, paymentId, amount);
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  return handleRazorpayWebhook({
    rawBody,
    signature: createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex"),
    eventId,
    secret: WEBHOOK_SECRET,
  });
}

async function stateOf(sessionId: string) {
  return (
    await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: { state: true } })
  ).state;
}

async function reservationsOf(sessionId: string) {
  return prisma.inventoryReservation.findMany({
    where: { checkoutSessionId: sessionId },
    select: { variantId: true, quantity: true, state: true },
    orderBy: { variantId: "asc" },
  });
}

/** Moves a session's holds (and, with `minutes` past the grace, its Razorpay window) into the past. */
async function backdateHolds(sessionId: string, minutesAgo: number) {
  await prisma.$executeRaw`
    UPDATE inventory_reservations
       SET expires_at = now() - make_interval(mins => ${minutesAgo}::int)
     WHERE checkout_session_id = ${sessionId}::uuid
  `;
  await prisma.$executeRaw`
    UPDATE checkout_sessions
       SET expires_at = now() - make_interval(mins => ${minutesAgo}::int)
     WHERE id = ${sessionId}::uuid
  `;
}

async function backdatePayment(sessionId: string) {
  await prisma.payment.update({
    where: { checkoutSessionId: sessionId },
    data: { createdAt: new Date(Date.now() - RECONCILE_AFTER_MS - 60_000) },
    select: { id: true },
  });
}

/** A reserved, payment_pending session with one Razorpay order — the state a customer is in while paying. */
async function payingSession(razorpay: FakeRazorpay, quantityOnHand = 5) {
  const variantId = await stockedVariant(fixtures, quantityOnHand, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: [{ variantId, quantity: 1 }],
    totalPaise: AMOUNT,
  });
  await reserveCheckoutSession(identity, sessionId);
  const order = await createPaymentOrder(identity, sessionId, razorpay);
  return { identity, sessionId, variantId, orderId: order.razorpayOrderId };
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the database backstop (task 1, Testing Requirements)", () => {
  it("the three Phase 2 inventory CHECK constraints are present and validated", async () => {
    const rows = await prisma.$queryRaw<{ conname: string; convalidated: boolean; def: string }[]>`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'inventory'::regclass AND contype = 'c'
       ORDER BY conname
    `;
    const defs = rows.map((row) => row.def.replace(/\s+/g, " "));
    expect(rows.every((row) => row.convalidated)).toBe(true);
    expect(defs).toEqual(
      expect.arrayContaining([
        expect.stringContaining("quantity_on_hand >= 0"),
        expect.stringContaining("quantity_reserved >= 0"),
        expect.stringContaining("(quantity_on_hand - quantity_reserved) >= 0"),
      ]),
    );
  });

  it.each([
    ["reserving more than is on hand", "quantity_reserved = quantity_on_hand + 1"],
    ["a negative reservation", "quantity_reserved = -1"],
    ["a negative stock level", "quantity_on_hand = -1, quantity_reserved = 0"],
  ])("rejects %s even when application logic is bypassed (SQLSTATE 23514)", async (_label, assignment) => {
    const variantId = await stockedVariant(fixtures, 1);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE inventory SET ${assignment} WHERE variant_id = $1::uuid`, variantId),
    ).rejects.toThrow(/23514|check constraint/i);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 1, quantityReserved: 0 });
  });

  it("a hold's quantity must be positive", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    const { sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await expect(
      prisma.inventoryReservation.create({
        data: { checkoutSessionId: sessionId, variantId, quantity: 0, expiresAt: new Date() },
      }),
    ).rejects.toThrow();
  });
});

describe("reserveCheckoutSession (tasks 2–5)", () => {
  it("holds the priced lines for 15 minutes and moves the session to reserved", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 2 }] });

    const view = await reserveCheckoutSession(identity, sessionId);

    expect(view.state).toBe(CheckoutState.reserved);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 2 });
    const [hold] = await prisma.inventoryReservation.findMany({
      where: { checkoutSessionId: sessionId },
      select: { state: true, quantity: true, expiresAt: true },
    });
    expect(hold?.state).toBe(ReservationState.held);
    expect(hold?.quantity).toBe(2);
    const ttlMs = (hold?.expiresAt.getTime() ?? 0) - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    // The session now lives as long as its hold, so no Razorpay order can outlive it.
    expect(view.expiresAt).toBe(hold?.expiresAt.toISOString());
  });

  it("10 concurrent buyers for the last unit: exactly one reservation, nine clean denials, stock never negative (Validation)", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    const buyers = await Promise.all(
      Array.from({ length: 10 }, () => pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] })),
    );

    const results = await Promise.allSettled(
      buyers.map(({ identity, sessionId }) => reserveCheckoutSession(identity, sessionId)),
    );

    const granted = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(granted).toHaveLength(1);
    expect(denied).toHaveLength(9);
    for (const denial of denied) expect(denial.reason).toBeInstanceOf(InsufficientStockError);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 1, quantityReserved: 1 });
    expect(await prisma.inventoryReservation.count({ where: { variantId, state: ReservationState.held } })).toBe(1);
    const states = await Promise.all(buyers.map(({ sessionId }) => stateOf(sessionId)));
    expect(states.filter((state) => state === CheckoutState.reserved)).toHaveLength(1);
    expect(states.filter((state) => state === CheckoutState.priced)).toHaveLength(9);
  });

  it("the inventory row lock is real: a reservation waits for a concurrent holder of the row", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });

    let releaseBlocker!: () => void;
    const blockerHolding = new Promise<void>((resolveHolding) => {
      void prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM inventory WHERE variant_id = ${variantId}::uuid FOR UPDATE`;
          resolveHolding();
          await new Promise<void>((resolve) => (releaseBlocker = resolve));
        },
        { timeout: 20_000 },
      );
    });
    await blockerHolding;

    let settled = false;
    const reservation = reserveCheckoutSession(identity, sessionId).finally(() => (settled = true));
    let waiting = 0;
    try {
      for (let i = 0; i < 50 && waiting === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
          SELECT count(*)::bigint AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE OF i%'
        `;
        waiting = Number(row?.waiting ?? 0);
      }
      expect(waiting).toBe(1);
      expect(settled).toBe(false);
    } finally {
      // Always let go, even when an assertion above failed, or the
      // blocker would hold the row lock into the next test's cleanup.
      releaseBlocker();
    }
    await expect(reservation).resolves.toMatchObject({ state: CheckoutState.reserved });
  });

  it("two carts holding the same two variants in opposite order never deadlock", async () => {
    const a = await stockedVariant(fixtures, 100);
    const b = await stockedVariant(fixtures, 100);
    const pairs = await Promise.all(
      Array.from({ length: 8 }, async () => [
        await pricedSession(fixtures, {
          lines: [
            { variantId: a, quantity: 1 },
            { variantId: b, quantity: 1 },
          ],
        }),
        await pricedSession(fixtures, {
          lines: [
            { variantId: b, quantity: 1 },
            { variantId: a, quantity: 1 },
          ],
        }),
      ]),
    );

    const results = await Promise.allSettled(
      pairs.flat().map(({ identity, sessionId }) => reserveCheckoutSession(identity, sessionId)),
    );

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(await stockOf(a)).toEqual({ quantityOnHand: 100, quantityReserved: 16 });
    expect(await stockOf(b)).toEqual({ quantityOnHand: 100, quantityReserved: 16 });
  });

  it("insufficient stock on one line reserves nothing at all", async () => {
    const plenty = await stockedVariant(fixtures, 5);
    const none = await stockedVariant(fixtures, 0);
    const { identity, sessionId } = await pricedSession(fixtures, {
      lines: [
        { variantId: plenty, quantity: 1 },
        { variantId: none, quantity: 1 },
      ],
    });

    const error = await reserveCheckoutSession(identity, sessionId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InsufficientStockError);
    expect((error as InsufficientStockError).unavailable).toEqual([
      { variantId: none, requested: 1, available: 0 },
    ]);
    expect(await stockOf(plenty)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    expect(await reservationsOf(sessionId)).toEqual([]);
    expect(await stateOf(sessionId)).toBe(CheckoutState.priced);
  });

  it("a variant archived after pricing cannot be reserved", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await prisma.productVariant.update({ where: { id: variantId }, data: { status: "archived" }, select: { id: true } });

    await expect(reserveCheckoutSession(identity, sessionId)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
  });

  it("five concurrent duplicate requests for one session hold the stock once", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 2 }] });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveCheckoutSession(identity, sessionId)),
    );

    expect(results.every((view) => view.state === CheckoutState.reserved)).toBe(true);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 2 });
    expect(await reservationsOf(sessionId)).toHaveLength(1);
  });

  it("a retry after the session moved on is answered from its current state, without holding again", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId, variantId } = await payingSession(razorpay);

    await expect(reserveCheckoutSession(identity, sessionId)).resolves.toMatchObject({
      state: CheckoutState.payment_pending,
    });
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
  });

  it("refuses a bag that changed after pricing, an expired price, and another identity's session", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const changed = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await prisma.cartItem.updateMany({ where: { cartId: changed.cartId }, data: { quantity: 3 } });
    await expect(reserveCheckoutSession(changed.identity, changed.sessionId)).rejects.toThrow(/changed/);

    const stale = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await prisma.checkoutSession.update({
      where: { id: stale.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
      select: { id: true },
    });
    await expect(reserveCheckoutSession(stale.identity, stale.sessionId)).rejects.toThrow(/expired/);

    const owned = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    const stranger = await guest(fixtures);
    await expect(reserveCheckoutSession(stranger, owned.sessionId)).rejects.toThrow(/not found/i);
    await expect(reserveCheckoutSession(stranger, "not-a-uuid")).rejects.toThrow(/not found/i);

    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
  });

  it("one identity cannot hold more than the per-identity cap of a variant across sessions", async () => {
    const variantId = await stockedVariant(fixtures, 50);
    const actor = await guest(fixtures);
    const first = await pricedSession(fixtures, {
      identity: actor,
      lines: [{ variantId, quantity: MAX_HELD_UNITS_PER_IDENTITY_PER_VARIANT }],
    });
    await reserveCheckoutSession(actor, first.sessionId);

    const second = await pricedSession(fixtures, { identity: actor, lines: [{ variantId, quantity: 1 }] });
    const error = await reserveCheckoutSession(actor, second.sessionId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).not.toBeInstanceOf(InsufficientStockError);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 50, quantityReserved: 10 });
  });
});

describe("commit on capture, release otherwise (task 6)", () => {
  it("a verified capture commits the hold once, however often it is delivered", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);

    for (let i = 0; i < 5; i += 1) await deliver("payment.captured", orderId);

    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    expect(await reservationsOf(sessionId)).toEqual([
      { variantId, quantity: 1, state: ReservationState.committed },
    ]);
  });

  it("a failed attempt keeps the hold for a retry; the captured retry commits exactly once", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);

    await deliver("payment.failed", orderId, "pay_attempt_1");
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);

    await deliver("payment.captured", orderId, "pay_attempt_2");
    await deliver("payment.failed", orderId, "pay_attempt_1");

    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
  });

  it("a capture for the wrong amount changes no stock and does not mark the session paid", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);

    await deliver("payment.captured", orderId, "pay_attempt_1", 100);

    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
  });
});

describe("reservation expiry (tasks 4, 6, 7)", () => {
  it("an expired hold with no Razorpay order is released and the session expired; a second run changes nothing", async () => {
    const variantId = await stockedVariant(fixtures, 3);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 2 }] });
    await reserveCheckoutSession(identity, sessionId);
    await backdateHolds(sessionId, 1);

    const first = await runMaintenance(null);
    expect(first.ok).toBe(true);
    expect(first.reconciliation.status).toBe("not_configured");
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 3, quantityReserved: 0 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
    expect(await reservationsOf(sessionId)).toEqual([
      { variantId, quantity: 2, state: ReservationState.expired },
    ]);

    await runMaintenance(null);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 3, quantityReserved: 0 });
  });

  it("two overlapping expiry runs release a hold exactly once", async () => {
    const variantId = await stockedVariant(fixtures, 4);
    const sessions = await Promise.all(
      Array.from({ length: 3 }, () => pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] })),
    );
    for (const { identity, sessionId } of sessions) {
      await reserveCheckoutSession(identity, sessionId);
      await backdateHolds(sessionId, 1);
    }

    const [a, b] = await Promise.all([expireReservations(null), expireReservations(null)]);

    expect(a.errors + b.errors).toBe(0);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    const expiredHolds = await prisma.inventoryReservation.count({
      where: { variantId, state: ReservationState.expired },
    });
    expect(expiredHolds).toBe(3);
  });

  it("released stock can be reserved by the next buyer", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    const first = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    const second = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await reserveCheckoutSession(first.identity, first.sessionId);
    await expect(reserveCheckoutSession(second.identity, second.sessionId)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );

    await backdateHolds(first.sessionId, 1);
    await expireReservations(null);

    await expect(reserveCheckoutSession(second.identity, second.sessionId)).resolves.toMatchObject({
      state: CheckoutState.reserved,
    });
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 1, quantityReserved: 1 });
  });

  it("a hold with a Razorpay order is kept during the payment grace period", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId } = await payingSession(razorpay);
    await backdateHolds(sessionId, 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.kept_in_payment_grace).toBe(1);
    expect(razorpay.listCalls).toBe(0);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("without Razorpay credentials, a hold with a Razorpay order is never released", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId } = await payingSession(razorpay);
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await runMaintenance(null);

    expect(report.expiry.status === "ok" && report.expiry.result.outcomes.kept_unverified).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("past the grace period, Razorpay reporting no attempt lets the hold go", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId } = await payingSession(razorpay);
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.expired).toBe(1);
    expect(razorpay.listCalls).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
  });

  it("an authorized payment keeps its hold at expiry — money may be about to move", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    await deliver("payment.authorized", orderId);
    razorpay.attempt(orderId, "pay_attempt_1", "authorized");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.kept_payment_in_progress).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("an attempt Razorpay still reports `created` keeps the hold past the grace period, so its late capture finds its stock", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    // A UPI collect the customer started before the hold lapsed, not yet approved.
    razorpay.attempt(orderId, "pay_attempt_1", "created");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 30);

    for (let run = 0; run < 2; run += 1) {
      const report = await expireReservations(razorpay);
      expect(report.outcomes.kept_attempt_unfinished).toBe(1);
      expect(report.outcomes.expired).toBe(0);
    }
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);

    // The customer approves; the capture lands long after the hold's expiry.
    const result = await deliver("payment.captured", orderId);

    expect(result.status).toBe(200);
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    expect(await reservationsOf(sessionId)).toEqual([
      { variantId, quantity: 1, state: ReservationState.committed },
    ]);
    await expireReservations(razorpay);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
  });

  it("an unfinished attempt alongside failed ones still keeps the hold", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "failed");
    razorpay.attempt(orderId, "pay_attempt_2", "created");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.kept_attempt_unfinished).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("an attempt status this code does not recognise is not treated as proof that no money moved", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "pending_new_razorpay_state");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.kept_attempt_unfinished).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("a capture the apply refuses (wrong amount) still keeps the hold: money moved", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "captured", AMOUNT - 1);
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.kept_attempt_unfinished).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
  });

  it("past the grace period, attempts that all failed let the hold go", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "failed");
    razorpay.attempt(orderId, "pay_attempt_2", "failed");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await expireReservations(razorpay);

    expect(report.outcomes.expired).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
  });
});

describe("reconciliation never marks the wrong thing paid, never releases a successful payment", () => {
  it("a capture whose webhook never came is found, commits the hold, and is not released", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "failed");
    razorpay.attempt(orderId, "pay_attempt_2", "captured");
    await backdatePayment(sessionId);
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await runMaintenance(razorpay);

    expect(report.ok).toBe(true);
    expect(report.reconciliation).toMatchObject({ status: "ok", result: { checked: 1, applied: 1 } });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    expect(await reservationsOf(sessionId)).toEqual([
      { variantId, quantity: 1, state: ReservationState.committed },
    ]);

    await runMaintenance(razorpay);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
  });

  it("expiry's own Razorpay check finds a capture inside the 30-minute reconcile window and commits instead of releasing", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "captured");
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

    const report = await runMaintenance(razorpay);

    expect(report.reconciliation).toMatchObject({ status: "ok", result: { checked: 0 } });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
  });

  it("a Razorpay amount mismatch is not treated as payment: the session is not paid and no stock is committed", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    razorpay.attempt(orderId, "pay_attempt_1", "captured", AMOUNT - 1);
    await backdatePayment(sessionId);

    await runMaintenance(razorpay);

    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { status: true } }))
        .status,
    ).toBe(PaymentStatus.created);
  });

  it("a capture that arrives after the hold was released records the money but never marks the session paid or touches stock", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);
    await expireReservations(razorpay);
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);

    const result = await deliver("payment.captured", orderId);

    expect(result.status).toBe(200);
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { checkoutSessionId: sessionId },
      select: { status: true },
    });
    expect(payment.status).toBe(PaymentStatus.captured);
    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: { in: eventIds } },
      select: { processingError: true },
    });
    expect(event.processingError).toMatch(/needs reconciliation/);
  });

  it("a capture racing the expiry job ends in exactly one consistent outcome, never paid-and-released", async () => {
    for (let round = 0; round < 6; round += 1) {
      const razorpay = new FakeRazorpay();
      const { sessionId, variantId, orderId } = await payingSession(razorpay);
      await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);

      await Promise.all([deliver("payment.captured", orderId), expireReservations(razorpay)]);

      const state = await stateOf(sessionId);
      const stock = await stockOf(variantId);
      const [hold] = await reservationsOf(sessionId);
      if (state === CheckoutState.paid) {
        expect(hold?.state).toBe(ReservationState.committed);
        expect(stock).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
      } else {
        expect(state).toBe(CheckoutState.expired);
        expect(hold?.state).toBe(ReservationState.expired);
        expect(stock).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
      }
    }
  });

  it("a hold that lapses while the Razorpay order is being created withholds the order from the browser", async () => {
    const razorpay = new FakeRazorpay();
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const { identity, sessionId } = await pricedSession(fixtures, {
      lines: [{ variantId, quantity: 1 }],
      totalPaise: AMOUNT,
    });
    await reserveCheckoutSession(identity, sessionId);
    razorpay.duringCreate = async () => {
      razorpay.duringCreate = null;
      await backdateHolds(sessionId, 1);
      await expireReservations(razorpay);
    };

    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(/lapsed/);

    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(/cannot take payment/);
  });

  it("once the hold has expired, the existing Razorpay order is never handed to the browser again", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId, variantId, orderId } = await payingSession(razorpay);

    // Control: while the hold is live, a retry gets the same order back.
    expect((await createPaymentOrder(identity, sessionId, razorpay)).razorpayOrderId).toBe(orderId);

    // Expired, but still inside the payment grace: the session is still
    // payment_pending and the stock still held — yet no new payment may start.
    await backdateHolds(sessionId, 1);
    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(/lapsed/);
    expect(razorpay.orders.size).toBe(1);
    expect(await stateOf(sessionId)).toBe(CheckoutState.payment_pending);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 1 });

    // So no late capture can start after this point: with no attempt on
    // the order, the job releases the stock once the grace has passed.
    await backdateHolds(sessionId, PAYMENT_GRACE_MINUTES + 1);
    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(/lapsed/);
    expect((await expireReservations(razorpay)).outcomes.expired).toBe(1);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toThrow(/cannot take payment/);
  });
});

describe("pruning (task 7)", () => {
  it("removes only rows past their retention, and keeps committed holds", async () => {
    const oldKey = `phase8-prune-old-${randomUUID()}`;
    const freshKey = `phase8-prune-fresh-${randomUUID()}`;
    await prisma.rateLimitCounter.createMany({
      data: [
        { key: oldKey, windowStart: new Date(Date.now() - 25 * 3600_000), count: 1 },
        { key: freshKey, windowStart: new Date(), count: 1 },
      ],
    });
    const oldEvent = `evt_prune_${randomUUID()}`;
    eventIds.push(oldEvent);
    await prisma.webhookEvent.create({
      data: {
        provider: "razorpay",
        providerEventId: oldEvent,
        eventType: "payment.captured",
        payload: {},
        receivedAt: new Date(Date.now() - 91 * 86_400_000),
      },
      select: { id: true },
    });

    const variantId = await stockedVariant(fixtures, 5);
    const released = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    const committed = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    await prisma.inventoryReservation.createMany({
      data: [
        { checkoutSessionId: released.sessionId, variantId, quantity: 1, state: "expired", expiresAt: eightDaysAgo },
        { checkoutSessionId: committed.sessionId, variantId, quantity: 1, state: "committed", expiresAt: eightDaysAgo },
      ],
    });
    await prisma.$executeRaw`
      UPDATE inventory_reservations SET updated_at = ${eightDaysAgo}
       WHERE checkout_session_id IN (${released.sessionId}::uuid, ${committed.sessionId}::uuid)
    `;

    const report = await pruneExpiredRows();

    expect(report.rateLimitCounters).toBeGreaterThanOrEqual(1);
    expect(report.webhookEvents).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitCounter.count({ where: { key: oldKey } })).toBe(0);
    expect(await prisma.rateLimitCounter.count({ where: { key: freshKey } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { providerEventId: oldEvent } })).toBe(0);
    expect(await reservationsOf(released.sessionId)).toEqual([]);
    expect(await reservationsOf(committed.sessionId)).toHaveLength(1);

    await prisma.rateLimitCounter.deleteMany({ where: { key: freshKey } });
  });
});

describe("POST /api/jobs/maintenance (task 7)", () => {
  it("fails closed: with no OIDC audience configured it refuses every caller and runs nothing", async () => {
    const { NextRequest } = await import("next/server");
    const route = await import("@/app/api/jobs/maintenance/route");
    const variantId = await stockedVariant(fixtures, 2);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await reserveCheckoutSession(identity, sessionId);
    await backdateHolds(sessionId, 1);

    for (const authorization of [undefined, "Bearer forged.token.value"]) {
      const response = await route.POST(
        new NextRequest("https://vokr.shop/api/jobs/maintenance", {
          method: "POST",
          headers: authorization ? { authorization } : {},
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    }
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 2, quantityReserved: 1 });
  });
});

describe("the real path, end to end: cart → address → pricing → reserve → Razorpay order → verified capture", () => {
  it("reserves exactly what Phase 6 priced, charges that amount, and commits the stock on capture", async () => {
    const razorpay = new FakeRazorpay();
    const variantId = await stockedVariant(fixtures, 3, 250_000);
    const identity = await guest(fixtures);

    await addItem(identity, { variantId, quantity: 2 });
    const created = await createCheckoutSession(identity, randomUUID());
    await setCheckoutAddress(identity, created.id, {
      name: "Asha Rao",
      phone: "+919876543210",
      line1: "12 MG Road",
      line2: undefined,
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      email: "asha@example.com",
    });
    const priced = await priceCheckoutSession(identity, created.id, "prepaid");
    const total = priced.pricingSnapshot?.totalPaise as number;
    expect(priced.pricingSnapshot?.lines).toMatchObject([{ variantId, quantity: 2 }]);

    const reserved = await reserveCheckoutSession(identity, created.id);
    expect(reserved.state).toBe(CheckoutState.reserved);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 3, quantityReserved: 2 });

    const order = await createPaymentOrder(identity, created.id, razorpay);
    expect(order.amountPaise).toBe(total);
    expect(razorpay.orders.get(order.razorpayOrderId)?.amount).toBe(total);

    await deliver("payment.captured", order.razorpayOrderId, "pay_real_path", total);

    expect(await stateOf(created.id)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 1, quantityReserved: 0 });
    expect(await reservationsOf(created.id)).toEqual([
      { variantId, quantity: 2, state: ReservationState.committed },
    ]);
  });
});
