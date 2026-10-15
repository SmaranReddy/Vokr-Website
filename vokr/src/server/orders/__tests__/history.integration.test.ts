import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/errors";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
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

import { getUserOrder, listUserOrders, ORDER_HISTORY_PAGE_SIZE } from "../history";

/**
 * Signed-in order history (plan §5 Phase 9, task 7; Security: "user A
 * cannot read user B's order"), against a real Postgres with real orders
 * made by a verified capture. The capture path is guest-shaped in the
 * fixtures, so ownership is assigned afterwards — exactly the column the
 * history reads.
 */

const SECRET = "whsec_history_fixture";
const AMOUNT = 999_500;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const userIds: string[] = [];

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

async function user(): Promise<string> {
  const id = randomUUID();
  await prisma.appUser.create({ data: { id, email: `${id}@example.com` }, select: { id: true } });
  userIds.push(id);
  return id;
}

/** A real order (capture → order), owned by `userId` when given. */
async function placedOrder(userId: string | null, placedAt?: Date): Promise<string> {
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.update({
    where: { checkoutSessionId: sessionId },
    data: { userId, ...(placedAt ? { placedAt } : {}) },
    select: { orderNumber: true },
  });
  return order.orderNumber;
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listUserOrders", () => {
  it("lists only the caller's orders, newest first", async () => {
    const alice = await user();
    const bob = await user();
    const older = await placedOrder(alice, new Date("2026-10-01T10:00:00Z"));
    const newer = await placedOrder(alice, new Date("2026-10-10T10:00:00Z"));
    await placedOrder(bob);
    await placedOrder(null); // a guest order

    const { orders, nextBefore } = await listUserOrders(alice);
    expect(orders.map((order) => order.orderNumber)).toEqual([newer, older]);
    expect(orders[0]).toMatchObject({ status: "confirmed", totalPaise: AMOUNT, itemCount: 1 });
    expect(nextBefore).toBeNull();
    expect((await listUserOrders(await user())).orders).toEqual([]);
  });

  it(`pages ${ORDER_HISTORY_PAGE_SIZE} at a time without gaps or repeats`, async () => {
    const alice = await user();
    const numbers: string[] = [];
    for (let i = 0; i < ORDER_HISTORY_PAGE_SIZE + 2; i += 1) {
      numbers.push(await placedOrder(alice, new Date(Date.UTC(2026, 9, 1, 0, i))));
    }
    const first = await listUserOrders(alice);
    expect(first.orders).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(first.nextBefore).not.toBeNull();
    const second = await listUserOrders(alice, { before: first.nextBefore ?? undefined });
    expect(second.nextBefore).toBeNull();
    const seen = [...first.orders, ...second.orders].map((order) => order.orderNumber);
    expect(seen).toEqual([...numbers].reverse());
  }, 60_000);

  it("a `before` cursor naming someone else's order is ignored, not followed", async () => {
    const alice = await user();
    const bob = await user();
    const mine = await placedOrder(alice);
    const theirs = await placedOrder(bob);
    expect((await listUserOrders(alice, { before: theirs })).orders.map((order) => order.orderNumber)).toEqual([mine]);
  });
});

describe("getUserOrder", () => {
  it("returns the caller's own order", async () => {
    const alice = await user();
    const orderNumber = await placedOrder(alice);
    await expect(getUserOrder(alice, orderNumber.toLowerCase())).resolves.toMatchObject({
      orderNumber,
      status: "confirmed",
      shipTo: { city: "Pune" },
    });
  });

  it("another customer's order is the same 404 as one that does not exist", async () => {
    const alice = await user();
    const bob = await user();
    const bobs = await placedOrder(bob);
    const guests = await placedOrder(null);

    const errors = await Promise.all(
      [bobs, guests, "VK-99999999", "garbage"].map((number) => getUserOrder(alice, number).catch((error: unknown) => error)),
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).message).toBe("Order not found.");
    }
  });
});
