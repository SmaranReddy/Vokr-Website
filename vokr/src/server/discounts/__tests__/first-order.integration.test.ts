import { createHmac, randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
import { CheckoutStaleError } from "@/lib/errors";
import { adminTransitionOrder } from "@/server/admin/orders";
import { exportShiprocketCsv, SHIPROCKET_HEADERS } from "@/server/admin/shiprocket-csv";
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

import { claimFirstOrderDiscount, discountKeys } from "../first-order";

/**
 * The first-order discount against a real Postgres: a new customer's first
 * order is priced, paid and recorded at 10% off with a claim on each of
 * their phone, email and name + address; any one of those keys makes the
 * next order full price; an order cancelled before it is fulfilled gives
 * the discount back; a discount priced before another order used it is
 * never handed to Razorpay; and the database refuses a total that ignores
 * its discount.
 */

const SECRET = "whsec_first_order_fixture";
const PRICE = 699_900;
const DISCOUNT = 69_990; // ₹699.90: exactly 10% of ₹6,999.
const ACTOR = "admin:first-order-test";
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

interface Customer {
  phone: string;
  email: string;
  name: string;
}

/** A customer none of whose keys can have been seen before. The fixture address is the same for all; the name tells them apart. */
function newCustomer(): Customer {
  const n = String(randomInt(0, 100_000_000)).padStart(8, "0");
  return { phone: `+9198${n}`, email: `buyer-${n}@example.com`, name: `Test Buyer ${n}` };
}

function keysOf(customer: Customer) {
  return discountKeys({ ...customer, line1: "1 Test Road", pincode: "411001" });
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

/** A session for `customer`, re-priced through the real pricing path. */
async function pricedFor(customer: Customer, variantId: string) {
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], ...customer });
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
      orderNumber: true,
      subtotalPaise: true,
      discountPaise: true,
      discountKind: true,
      taxPaise: true,
      totalPaise: true,
      items: { select: { lineSubtotalPaise: true, lineDiscountPaise: true, lineTaxPaise: true } },
      firstOrderDiscountClaims: { select: { keyKind: true, keyHash: true }, orderBy: { keyKind: "asc" } },
    },
  });
}

async function variant() {
  const variantId = await stockedVariant(fixtures, 10, PRICE);
  invalidateCatalogCache();
  return variantId;
}

beforeEach(() => {
  invalidateCatalogCache();
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { actor: ACTOR } });
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("first-order discount", () => {
  it("a new customer's first order is ₹699.90 off, GST on the discounted price, and claims all three keys", async () => {
    const customer = newCustomer();
    const { identity, sessionId, snapshot } = await pricedFor(customer, await variant());

    expect(snapshot.discount).toEqual({ kind: "first_order", rateBps: 1000 });
    expect(snapshot.discountPaise).toBe(DISCOUNT);
    expect(snapshot.totalPaise).toBe(PRICE - DISCOUNT);
    // (699900 - 69990) * 1800 / 11800 = 96087.97 -> 96088.
    expect(snapshot.taxPaise).toBe(96_088);

    const order = await payFor(identity, sessionId);
    expect(order).toMatchObject({
      subtotalPaise: PRICE,
      discountPaise: DISCOUNT,
      discountKind: "first_order",
      taxPaise: 96_088,
      totalPaise: PRICE - DISCOUNT, // ₹6,299.10
    });
    expect(order.items).toEqual([{ lineSubtotalPaise: PRICE, lineDiscountPaise: DISCOUNT, lineTaxPaise: 96_088 }]);
    const expected = keysOf(customer).map((key) => ({ keyKind: key.kind, keyHash: key.hash }));
    expect(order.firstOrderDiscountClaims).toEqual(expected.sort((a, b) => a.keyKind.localeCompare(b.keyKind)));
  });

  it("any one known key — phone, email, or name + address — makes the next order full price", async () => {
    const variantId = await variant();
    const customer = newCustomer();
    const first = await pricedFor(customer, variantId);
    await payFor(first.identity, first.sessionId);

    const fresh = newCustomer();
    for (const repeat of [
      { ...fresh, phone: customer.phone },
      { ...fresh, email: customer.email },
      { ...fresh, name: customer.name },
    ]) {
      const again = await pricedFor(repeat, variantId);
      expect(again.snapshot.discount).toBeNull();
      expect(again.snapshot.totalPaise).toBe(PRICE);
    }

    const second = await pricedFor(customer, variantId);
    const order = await payFor(second.identity, second.sessionId);
    expect(order).toMatchObject({ discountPaise: 0, discountKind: null, totalPaise: PRICE, firstOrderDiscountClaims: [] });

    // Someone with no key in common is a new customer.
    expect((await pricedFor(fresh, variantId)).snapshot.discountPaise).toBe(DISCOUNT);
  });

  it("an order cancelled before it is fulfilled gives the discount back", async () => {
    const variantId = await variant();
    const customer = newCustomer();
    const first = await pricedFor(customer, variantId);
    const order = await payFor(first.identity, first.sessionId);
    expect(order.firstOrderDiscountClaims).toHaveLength(3);

    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.cancelled });
    expect(await prisma.firstOrderDiscountClaim.count({ where: { orderId: order.id } })).toBe(0);
    expect((await pricedFor(customer, variantId)).snapshot.discountPaise).toBe(DISCOUNT);
  });

  it("a discount priced before another order used it is never handed to Razorpay", async () => {
    const variantId = await variant();
    const customer = newCustomer();
    const late = await pricedFor(customer, variantId);
    expect(late.snapshot.discountPaise).toBe(DISCOUNT);

    const early = await pricedFor(customer, variantId);
    await payFor(early.identity, early.sessionId);

    await reserveCheckoutSession(late.identity, late.sessionId);
    const razorpay = new FakeRazorpay();
    await expect(createPaymentOrder(late.identity, late.sessionId, razorpay)).rejects.toThrow(CheckoutStaleError);
    expect(razorpay.orders.size).toBe(0);
  });

  it("claiming known keys again is a no-op inside the capture, never an error", async () => {
    const customer = newCustomer();
    const { identity, sessionId } = await pricedFor(customer, await variant());
    const order = await payFor(identity, sessionId);

    const again = await prisma.$transaction((tx) => claimFirstOrderDiscount(tx, { keys: keysOf(customer), orderId: order.id }));
    expect(again).toBe(false);
    expect(await prisma.firstOrderDiscountClaim.count({ where: { orderId: order.id } })).toBe(3);
  });

  it("the Shiprocket export carries the discount, so its order value is what was charged", async () => {
    const { identity, sessionId } = await pricedFor(newCustomer(), await variant());
    const order = await payFor(identity, sessionId);
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });

    const { csv } = await exportShiprocketCsv(ACTOR, OrderStatus.preparing);
    const row = csv.split("\r\n").find((line) => line.startsWith(`${order.orderNumber},`))!;
    const cells = row.split(",");
    const at = (header: string) => cells[SHIPROCKET_HEADERS.indexOf(header as (typeof SHIPROCKET_HEADERS)[number])];
    expect(at("*Selling Price(Per Unit Item, Inclusive of Tax)")).toBe("6999.00");
    expect(at("Total Discount (Per Order)")).toBe("699.90");
  });

  it("the database refuses a total that ignores the discount, or a discount with no kind", async () => {
    const { identity, sessionId } = await pricedFor(newCustomer(), await variant());
    const order = await payFor(identity, sessionId);

    await expect(prisma.order.update({ where: { id: order.id }, data: { totalPaise: PRICE } })).rejects.toThrow(/orders_total_adds_up/);
    await expect(prisma.order.update({ where: { id: order.id }, data: { discountKind: null } })).rejects.toThrow(/orders_discount_valid/);
    await expect(
      prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { lineDiscountPaise: PRICE + 1 } }),
    ).rejects.toThrow(/order_items_discount_valid/);
  });
});
