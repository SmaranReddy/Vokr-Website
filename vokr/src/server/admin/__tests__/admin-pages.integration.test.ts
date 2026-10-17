import { createHmac, randomUUID } from "node:crypto";

import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { OrderStatus, ReturnKind, ReturnRefundMode, ReturnState } from "@/generated/prisma/enums";
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

async function placedOrder(lineCount = 1) {
  const razorpay = new FakeRazorpay();
  const variantIds: string[] = [];
  for (let i = 0; i < lineCount; i += 1) variantIds.push(await stockedVariant(fixtures, 5, AMOUNT));
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: variantIds.map((variantId) => ({ variantId, quantity: 1 })),
    totalPaise: AMOUNT * lineCount,
  });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const providerPaymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: providerPaymentId, order_id: razorpayOrderId, amount: AMOUNT * lineCount, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: { id: true, orderNumber: true, paymentId: true, items: { select: { id: true, variantId: true }, orderBy: { id: "asc" } } },
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

describe("admin pages render returns, exchanges and RTO with real rows", () => {
  it("shows each row's next step on the order page and the open ones on Exceptions", async () => {
    const order = await placedOrder(3);
    await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.delivered }, select: { id: true } });
    const [a, b, c] = order.items;
    await prisma.returnRequest.createMany({
      data: [
        { orderId: order.id, orderItemId: a!.id, kind: ReturnKind.return, reason: "size_fit", quantity: 1, requestedBy: "guest" },
        {
          orderId: order.id,
          orderItemId: b!.id,
          kind: ReturnKind.return,
          reason: "defective",
          quantity: 1,
          requestedBy: "guest",
          state: ReturnState.received,
          qcPassed: true,
          refundMode: ReturnRefundMode.manual_due,
          refundDuePaise: AMOUNT,
        },
        {
          orderId: order.id,
          orderItemId: c!.id,
          kind: ReturnKind.exchange,
          reason: "size_fit",
          quantity: 1,
          requestedBy: "guest",
          requestedVariantId: c!.variantId,
          state: ReturnState.approved,
        },
      ],
    });

    const { default: OrderPage } = await import("@/app/admin/orders/[orderNumber]/page");
    const detail = await render(OrderPage({ params: Promise.resolve({ orderNumber: order.orderNumber }) } as never));
    expect(detail).toContain("Returns, exchanges and RTO");
    expect(detail).toContain("Approve");
    expect(detail).toContain("Record refund");
    expect(detail).toContain("Mark received");
    expect(detail).not.toContain("Queue full refund"); // a partial refund is recorded

    const { default: ExceptionsPage } = await import("@/app/admin/exceptions/page");
    const exceptions = await render(ExceptionsPage());
    expect(exceptions).toContain("Returns and exchanges waiting on you");
    expect(exceptions).toContain(order.orderNumber);

    const rto = await placedOrder();
    await prisma.order.update({ where: { id: rto.id }, data: { status: OrderStatus.rto }, select: { id: true } });
    const rtoPage = await render(OrderPage({ params: Promise.resolve({ orderNumber: rto.orderNumber }) } as never));
    expect(rtoPage).toContain("RTO received");
  });
});
