import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { CheckoutState, OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { decryptField } from "@/server/checkout/crypto";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import type { RazorpayClient, RazorpayOrder, RazorpayPayment } from "@/server/payments/razorpay";
import { reconcilePendingPayments, RECONCILE_AFTER_MS } from "@/server/payments/reconcile";
import { createPaymentOrder, getPaymentStatus } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { findOrderOrphans } from "../reconcile";

/**
 * Plan §5 Phase 9 (slice 1), against a real Postgres: a verified capture
 * turns a paid checkout into exactly one order, built only from the
 * pricing snapshot, numbered `VK-#####`, with its first history row — and
 * no other path (late money, wrong amount, a bag already paid) ever does.
 */

const SECRET = "whsec_orders_fixture";
const AMOUNT = 999_500;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  readonly payments = new Map<string, RazorpayPayment[]>();
  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
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

function event(type: string, orderId: string, paymentId: string, extra: { amount?: number; refund?: boolean } = {}) {
  const amount = extra.amount ?? AMOUNT;
  return JSON.stringify({
    entity: "event",
    event: type,
    payload: {
      ...(extra.refund
        ? { refund: { entity: { id: `rfnd_${paymentId}`, payment_id: paymentId, amount, status: "processed" } } }
        : {}),
      payment: {
        entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: type.replace("payment.", "") },
      },
    },
  });
}

async function deliver(rawBody: string) {
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  return handleRazorpayWebhook({
    rawBody,
    signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"),
    eventId,
    secret: SECRET,
  });
}

async function payingSession(razorpay = new FakeRazorpay(), quantity = 1) {
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: [{ variantId, quantity }],
    totalPaise: AMOUNT * quantity,
  });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  return { razorpay, identity, sessionId, variantId, orderId: razorpayOrderId };
}

async function ordersFor(sessionId: string) {
  return prisma.order.findMany({
    where: { checkoutSessionId: sessionId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalPaise: true,
      subtotalPaise: true,
      taxPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      contactEmailEnc: true,
      shipCity: true,
      paymentId: true,
      items: { select: { sku: true, quantity: true, unitPricePaise: true, lineSubtotalPaise: true, lineTaxPaise: true } },
      history: { select: { fromStatus: true, toStatus: true, actor: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a verified capture makes exactly one order", () => {
  it("built from the pricing snapshot to the paise, numbered VK-#####, with its first history row", async () => {
    const { identity, sessionId, orderId } = await payingSession();
    await deliver(event("payment.captured", orderId, "pay_ord_1"));

    const [order, ...more] = await ordersFor(sessionId);
    expect(more).toHaveLength(0);
    const session = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { state: true, pricingSnapshot: true },
    });
    const snapshot = session.pricingSnapshot as {
      totalPaise: number;
      subtotalPaise: number;
      taxPaise: number;
      shippingPaise: number;
      codFeePaise: number;
      lines: { sku: string; quantity: number; unitPricePaise: number; lineSubtotalPaise: number; lineTaxPaise: number }[];
    };
    expect(session.state).toBe(CheckoutState.paid);
    expect(order).toMatchObject({
      orderNumber: expect.stringMatching(/^VK-\d{5,}$/),
      status: OrderStatus.confirmed,
      totalPaise: snapshot.totalPaise,
      subtotalPaise: snapshot.subtotalPaise,
      taxPaise: snapshot.taxPaise,
      shippingPaise: snapshot.shippingPaise,
      codFeePaise: snapshot.codFeePaise,
      shipCity: "Pune",
    });
    expect(order?.items).toEqual(
      snapshot.lines.map((line) => ({
        sku: line.sku,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        lineSubtotalPaise: line.lineSubtotalPaise,
        lineTaxPaise: line.lineTaxPaise,
      })),
    );
    expect(order?.history).toEqual([{ fromStatus: null, toStatus: OrderStatus.confirmed, actor: "system:payment" }]);
    expect(decryptField(order?.contactEmailEnc ?? "")).toBe("buyer@example.com");
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { checkoutSessionId: sessionId },
      select: { id: true, amountPaise: true },
    });
    expect(order?.paymentId).toBe(payment.id);
    expect(order?.totalPaise).toBe(payment.amountPaise);

    // The browser's status read now names the order.
    expect((await getPaymentStatus(identity, sessionId)).orderNumber).toBe(order?.orderNumber);
  });

  it("five replays and two concurrent duplicates still make one order", async () => {
    const { sessionId, orderId } = await payingSession();
    const captured = event("payment.captured", orderId, "pay_ord_dup");
    await Promise.all([deliver(captured), deliver(captured)]);
    for (let i = 0; i < 5; i += 1) await deliver(captured);
    await deliver(event("order.paid", orderId, "pay_ord_dup"));

    expect(await ordersFor(sessionId)).toHaveLength(1);
  });

  it("the reconciliation path (no webhook) makes the same single order", async () => {
    const { razorpay, sessionId, orderId } = await payingSession();
    razorpay.payments.set(orderId, [
      { id: "pay_ord_recon", order_id: orderId, amount: AMOUNT, currency: "INR", status: "captured" },
    ]);
    const later = new Date(Date.now() + RECONCILE_AFTER_MS + 1000);
    await reconcilePendingPayments(razorpay, later);
    await reconcilePendingPayments(razorpay, later);
    await deliver(event("payment.captured", orderId, "pay_ord_recon"));

    expect(await ordersFor(sessionId)).toHaveLength(1);
  });

  it("concurrent captures of different checkouts get distinct, increasing order numbers", async () => {
    const sessions = [];
    for (let i = 0; i < 6; i += 1) sessions.push(await payingSession());
    await Promise.all(
      sessions.map((session, i) => deliver(event("payment.captured", session.orderId, `pay_ord_many_${i}`))),
    );
    const numbers = (await prisma.order.findMany({
      where: { checkoutSessionId: { in: sessions.map((session) => session.sessionId) } },
      select: { orderNumber: true },
    })).map((order) => Number(order.orderNumber.slice(3)));

    expect(numbers).toHaveLength(6);
    expect(new Set(numbers).size).toBe(6);
    expect(numbers.every((value) => value >= 10_001)).toBe(true);
  });
});

describe("a session that could not become an order is never given a payment", () => {
  async function reservedSession() {
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
    await reserveCheckoutSession(identity, sessionId);
    return { identity, sessionId };
  }

  it("no contact email", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    await prisma.checkoutSession.update({ where: { id: sessionId }, data: { contactEmailEnc: null }, select: { id: true } });

    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toMatchObject({ code: "CHECKOUT_STALE" });
    expect(razorpay.orders.size).toBe(0);
  });

  it("a priced line without its HSN code", async () => {
    const razorpay = new FakeRazorpay();
    const { identity, sessionId } = await reservedSession();
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: { pricingSnapshot: true } });
    const snapshot = row.pricingSnapshot as { lines: Record<string, unknown>[] };
    await prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { pricingSnapshot: { ...snapshot, lines: snapshot.lines.map((line) => ({ ...line, hsnCode: null })) } },
      select: { id: true },
    });

    await expect(createPaymentOrder(identity, sessionId, razorpay)).rejects.toMatchObject({ code: "CHECKOUT_STALE" });
    expect(razorpay.orders.size).toBe(0);
  });
});

describe("money that is not a valid order never becomes one", () => {
  it("a capture for the wrong amount", async () => {
    const { sessionId, orderId } = await payingSession();
    await deliver(event("payment.captured", orderId, "pay_ord_short", { amount: 100 }));
    expect(await ordersFor(sessionId)).toHaveLength(0);
  });

  it("an authorization alone", async () => {
    const { sessionId, orderId } = await payingSession();
    await deliver(event("payment.authorized", orderId, "pay_ord_auth"));
    expect(await ordersFor(sessionId)).toHaveLength(0);
  });

  it("a second tab paying for a bag already paid", async () => {
    const razorpay = new FakeRazorpay();
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const a = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
    const b = await pricedSession(fixtures, {
      lines: [{ variantId, quantity: 1 }],
      totalPaise: AMOUNT,
      identity: a.identity,
    });
    await reserveCheckoutSession(a.identity, a.sessionId);
    await reserveCheckoutSession(a.identity, b.sessionId);
    const orderA = (await createPaymentOrder(a.identity, a.sessionId, razorpay)).razorpayOrderId;
    const orderB = (await createPaymentOrder(a.identity, b.sessionId, razorpay)).razorpayOrderId;

    await Promise.all([
      deliver(event("payment.captured", orderA, "pay_ord_tab_a")),
      deliver(event("payment.captured", orderB, "pay_ord_tab_b")),
    ]);

    const total = (await ordersFor(a.sessionId)).length + (await ordersFor(b.sessionId)).length;
    expect(total).toBe(1);
  });
});

describe("after the order exists", () => {
  it("a full refund of its payment moves it to refunded, with history", async () => {
    const { sessionId, orderId } = await payingSession();
    await deliver(event("payment.captured", orderId, "pay_ord_ref"));
    await deliver(event("refund.processed", orderId, "pay_ord_ref", { refund: true }));
    await deliver(event("refund.processed", orderId, "pay_ord_ref", { refund: true }));

    const [order] = await ordersFor(sessionId);
    expect(order?.status).toBe(OrderStatus.refunded);
    expect(order?.history.map((row) => row.toStatus)).toEqual([OrderStatus.confirmed, OrderStatus.refunded]);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { status: true } }))
        .status,
    ).toBe(PaymentStatus.refunded);
  });

  it("the orphan check is clean, and flags a paid checkout whose order went missing", async () => {
    const { sessionId, orderId } = await payingSession();
    await deliver(event("payment.captured", orderId, "pay_ord_orphan"));
    expect(await findOrderOrphans()).toEqual({
      paidSessionsWithoutOrder: 0,
      capturedPaymentsUnaccounted: 0,
      ordersWithoutCapture: 0,
    });

    const [order] = await ordersFor(sessionId);
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: order?.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: order?.id } });
    await prisma.order.delete({ where: { id: order?.id } });

    expect(await findOrderOrphans()).toEqual({
      paidSessionsWithoutOrder: 1,
      capturedPaymentsUnaccounted: 1,
      ordersWithoutCapture: 0,
    });
  });
});
