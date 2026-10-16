import { createHmac, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { CheckoutState } from "@/generated/prisma/enums";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { GUEST_COOKIE_NAME, getOrCreateGuestSession } from "@/server/auth/guest";
import type { CookieWrite } from "@/server/auth/supabase";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import { listUserOrders } from "@/server/orders/history";
import type { RazorpayClient, RazorpayOrder } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

/**
 * A guest who started checkout, then signs in on the same device (the real
 * `completeSignIn` path, which deletes the guest session). The checkout
 * sessions — and an order already paid as that guest — must move to the
 * account, never be orphaned, and must never stop the sign-in.
 */

const AMOUNT = 999_500;
const SECRET = "whsec_handover_fixture";
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

/** A guest with a real cookie token, tracked for cleanup. */
async function realGuest() {
  const guest = await getOrCreateGuestSession(undefined);
  fixtures.guestSessionIds.push(guest.guestSessionId);
  return { identity: { type: "guest" as const, guestSessionId: guest.guestSessionId }, token: guest.setCookie!.value };
}

async function signIn(token: string): Promise<string> {
  const userId = randomUUID();
  userIds.push(userId);
  const cookiesToSet: CookieWrite[] = [];
  await completeSignIn({
    request: new NextRequest("https://vokr.shop/api/auth/signin", { headers: { cookie: `${GUEST_COOKIE_NAME}=${token}` } }),
    cookiesToSet,
    userId,
    userEmail: `${userId}@example.com`,
  });
  return userId;
}

afterEach(async () => {
  // Sessions moved to a user are no longer found by guest id; clean them up by user too.
  const moved = await prisma.checkoutSession.findMany({ where: { userId: { in: userIds } }, select: { id: true, cartId: true } });
  const movedIds = moved.map((row) => row.id);
  const movedCartIds = moved.map((row) => row.cartId);
  await prisma.inventoryReservation.deleteMany({ where: { checkoutSessionId: { in: movedIds } } });
  await prisma.orderStatusHistory.deleteMany({ where: { order: { checkoutSessionId: { in: movedIds } } } });
  await prisma.orderItem.deleteMany({ where: { order: { checkoutSessionId: { in: movedIds } } } });
  await prisma.emailLog.deleteMany({ where: { order: { checkoutSessionId: { in: movedIds } } } });
  await prisma.order.deleteMany({ where: { checkoutSessionId: { in: movedIds } } });
  await prisma.payment.deleteMany({ where: { checkoutSessionId: { in: movedIds } } });
  await prisma.checkoutSession.deleteMany({ where: { id: { in: movedIds } } });
  const cartWhere = { OR: [{ userId: { in: userIds } }, { id: { in: movedCartIds } }] };
  await prisma.cartItem.deleteMany({ where: { cart: cartWhere } });
  await prisma.cart.deleteMany({ where: cartWhere });
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("signing in after starting checkout as a guest", () => {
  it("succeeds, and the open checkout session moves to the account", async () => {
    const { identity, token } = await realGuest();
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const { sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT, identity });

    const userId = await signIn(token);

    const session = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true, guestSessionId: true, state: true },
    });
    expect(session).toEqual({ userId, guestSessionId: null, state: CheckoutState.priced });
    expect(await prisma.guestSession.count({ where: { id: identity.guestSessionId } })).toBe(0);
  });

  it("an order paid as the guest appears in the account's order history", async () => {
    const { identity, token } = await realGuest();
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const { sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT, identity });
    await reserveCheckoutSession(identity, sessionId);
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, new FakeRazorpay());
    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
    });
    const eventId = `evt_${randomUUID()}`;
    eventIds.push(eventId);
    await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
    const { orderNumber } = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { orderNumber: true } });

    const userId = await signIn(token);

    expect((await listUserOrders(userId)).orders.map((order) => order.orderNumber)).toEqual([orderNumber]);
  });

  it("an order that already belongs to another account is never moved", async () => {
    const { identity, token } = await realGuest();
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const { sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT, identity });
    await reserveCheckoutSession(identity, sessionId);
    const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, new FakeRazorpay());
    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
    });
    const eventId = `evt_${randomUUID()}`;
    eventIds.push(eventId);
    await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
    const owner = randomUUID();
    userIds.push(owner);
    await prisma.appUser.create({ data: { id: owner, email: `${owner}@example.com` }, select: { id: true } });
    await prisma.order.update({ where: { checkoutSessionId: sessionId }, data: { userId: owner }, select: { id: true } });

    const userId = await signIn(token);

    expect((await listUserOrders(userId)).orders).toEqual([]);
    expect((await listUserOrders(owner)).orders).toHaveLength(1);
  });
});
