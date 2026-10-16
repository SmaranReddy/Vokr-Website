import { createHmac, randomUUID } from "node:crypto";

import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
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

/**
 * The admin pages rendered with real data from a real Postgres — the
 * evidence that they do not crash on actual rows (dates, JSON, nulls),
 * since no admin session exists to open them in a browser yet. The guard
 * is stubbed here (it is tested in `admin.integration.test.ts` and
 * `proxy-admin.test.ts`); everything below it is real.
 */

vi.mock("@/server/admin/page-guard", () => ({
  requireAdminPage: async () => ({ adminId: "page-test", actor: "admin:page-test" }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
}));

const SECRET = "whsec_admin_pages";
const AMOUNT = 999_500;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const orderIds: string[] = [];

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

async function placedOrder() {
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const providerPaymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: providerPaymentId, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: { id: true, orderNumber: true, paymentId: true },
  });
  orderIds.push(order.id);
  return { ...order, providerPaymentId };
}

async function render(element: ReactElement | Promise<ReactElement>): Promise<string> {
  return renderToString(await element);
}

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: orderIds } }, { actor: "admin:page-test" }] } });
  orderIds.length = 0;
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("admin pages render with real data", () => {
  it("orders list, order detail, inventory and exceptions", async () => {
    const order = await placedOrder();
    // A second Razorpay attempt on the same payment row (an extra payment):
    // it must not hide the refund for the captured one.
    await prisma.paymentIssue.create({
      data: {
        paymentId: order.paymentId!,
        providerPaymentId: `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
        amountPaise: AMOUNT,
        reason: "additional_payment",
      },
      select: { id: true },
    });

    const { default: OrdersPage } = await import("@/app/admin/orders/page");
    const list = await render(OrdersPage({ searchParams: Promise.resolve({}) } as never));
    expect(list).toContain(order.orderNumber);

    const { default: OrderPage } = await import("@/app/admin/orders/[orderNumber]/page");
    const detail = await render(OrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) } as never));
    expect(detail).toContain(order.orderNumber);
    expect(detail).toContain("additional_payment");
    expect(detail).toContain("Queue full refund");
    expect(detail).toContain(OrderStatus.preparing);

    const { default: InventoryPage } = await import("@/app/admin/inventory/page");
    expect(await render(InventoryPage())).toContain("Reservation fixture");

    const { default: ExceptionsPage } = await import("@/app/admin/exceptions/page");
    expect(await render(ExceptionsPage())).toContain("additional_payment");
  });
});
