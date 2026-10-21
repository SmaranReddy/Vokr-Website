import { createHmac, randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CheckoutStaleError } from "@/lib/errors";
import { invalidateCatalogCache } from "@/server/catalog";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { priceCheckoutSession } from "@/server/checkout/service";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import type { RazorpayClient, RazorpayOrder } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { claimFirstOrderDiscount, phoneHashFromEncrypted } from "../first-order";

/**
 * The first-order discount against a real Postgres: a new phone's first
 * order is priced, paid and recorded at 10% off with its claim; the same
 * phone's next order is full price; a discount priced before another order
 * claimed the phone is never handed to Razorpay; and the database itself
 * refuses an order whose total ignores its discount.
 */

const SECRET = "whsec_first_order_fixture";
const PRICE = 699_900;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    const order = { id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`, amount: input.amountPaise, currency: "INR", receipt: input.receipt, status: "created" };
    this.orders.set(order.id, order);
    return order;
  }
  async findOrderByReceipt(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt) ?? null;
  }
  async listOrderPayments() {
    return [];
  }
}

function newPhone(): string {
  return `+9198${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

async function capture(razorpayOrderId: string, amount: number) {
  const paymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, amount, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({
    rawBody,
    signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"),
    eventId,
    secret: SECRET,
  });
}

/** A session for `phone`, re-priced through the real pricing path. */
async function pricedFor(phone: string, variantId: string) {
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], phone });
  const view = await priceCheckoutSession(identity, sessionId, "prepaid");
  return { identity, sessionId, snapshot: view.pricingSnapshot! };
}

async function payFor(identity: Awaited<ReturnType<typeof pricedFor>>["identity"], sessionId: string) {
  await reserveCheckoutSession(identity, sessionId);
  const razorpay = new FakeRazorpay();
  const order = await createPaymentOrder(identity, sessionId, razorpay);
  await capture(order.razorpayOrderId, order.amountPaise);
  return prisma.order.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: {
      id: true,
      subtotalPaise: true,
      discountPaise: true,
      discountKind: true,
      taxPaise: true,
      totalPaise: true,
      shipPhoneEnc: true,
      items: { select: { lineSubtotalPaise: true, lineDiscountPaise: true, lineTaxPaise: true } },
      firstOrderDiscountClaim: { select: { phoneHash: true } },
    },
  });
}

beforeEach(() => {
  invalidateCatalogCache();
});

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("first-order discount", () => {
  it("a new phone's first order is 10% off, GST on the discounted price, and claims the phone", async () => {
    const phone = newPhone();
    const variantId = await stockedVariant(fixtures, 5, PRICE);
    invalidateCatalogCache();
    const { identity, sessionId, snapshot } = await pricedFor(phone, variantId);

    expect(snapshot.discount).toEqual({ kind: "first_order", rateBps: 1000 });
    expect(snapshot.discountPaise).toBe(70_000);
    expect(snapshot.totalPaise).toBe(PRICE - 70_000);
    // (699900 - 70000) * 1800 / 11800 = 96086.44 -> 96086.
    expect(snapshot.taxPaise).toBe(96_086);

    const order = await payFor(identity, sessionId);
    expect(order).toMatchObject({
      subtotalPaise: PRICE,
      discountPaise: 70_000,
      discountKind: "first_order",
      taxPaise: 96_086,
      totalPaise: 629_900,
    });
    expect(order.items).toEqual([{ lineSubtotalPaise: PRICE, lineDiscountPaise: 70_000, lineTaxPaise: 96_086 }]);
    expect(order.firstOrderDiscountClaim?.phoneHash).toBe(phoneHashFromEncrypted(order.shipPhoneEnc));
  });

  it("the same phone's next order is full price", async () => {
    const phone = newPhone();
    const variantId = await stockedVariant(fixtures, 5, PRICE);
    invalidateCatalogCache();
    const first = await pricedFor(phone, variantId);
    await payFor(first.identity, first.sessionId);

    const second = await pricedFor(phone, variantId);
    expect(second.snapshot.discount).toBeNull();
    expect(second.snapshot.discountPaise).toBe(0);
    expect(second.snapshot.totalPaise).toBe(PRICE);
    const order = await payFor(second.identity, second.sessionId);
    expect(order).toMatchObject({ discountPaise: 0, discountKind: null, totalPaise: PRICE, firstOrderDiscountClaim: null });

    // A different number is a first order again (the rule is per phone).
    const other = await pricedFor(newPhone(), variantId);
    expect(other.snapshot.discountPaise).toBe(70_000);
  });

  it("a discount priced before another order claimed the phone is never handed to Razorpay", async () => {
    const phone = newPhone();
    const variantId = await stockedVariant(fixtures, 5, PRICE);
    invalidateCatalogCache();
    const late = await pricedFor(phone, variantId);
    expect(late.snapshot.discountPaise).toBe(70_000);

    const early = await pricedFor(phone, variantId);
    await payFor(early.identity, early.sessionId);

    await reserveCheckoutSession(late.identity, late.sessionId);
    const razorpay = new FakeRazorpay();
    await expect(createPaymentOrder(late.identity, late.sessionId, razorpay)).rejects.toThrow(CheckoutStaleError);
    expect(razorpay.orders.size).toBe(0);
  });

  it("a second claim on one phone is a no-op inside the capture, never an error", async () => {
    const phone = newPhone();
    const variantId = await stockedVariant(fixtures, 5, PRICE);
    invalidateCatalogCache();
    const { identity, sessionId } = await pricedFor(phone, variantId);
    const order = await payFor(identity, sessionId);
    const phoneHash = phoneHashFromEncrypted(order.shipPhoneEnc);

    const again = await prisma.$transaction((tx) => claimFirstOrderDiscount(tx, { phoneHash, orderId: order.id }));
    expect(again).toBe(false);
    expect(await prisma.firstOrderDiscountClaim.count({ where: { phoneHash } })).toBe(1);
  });

  it("the database refuses a total that ignores the discount, or a discount with no kind", async () => {
    const variantId = await stockedVariant(fixtures, 5, PRICE);
    invalidateCatalogCache();
    const { identity, sessionId } = await pricedFor(newPhone(), variantId);
    const order = await payFor(identity, sessionId);

    await expect(prisma.order.update({ where: { id: order.id }, data: { totalPaise: PRICE } })).rejects.toThrow(/orders_total_adds_up/);
    await expect(prisma.order.update({ where: { id: order.id }, data: { discountKind: null } })).rejects.toThrow(/orders_discount_valid/);
    await expect(
      prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { lineDiscountPaise: PRICE + 1 } }),
    ).rejects.toThrow(/order_items_discount_valid/);
  });
});
