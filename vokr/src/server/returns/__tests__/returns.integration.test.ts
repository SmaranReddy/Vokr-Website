import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  CatalogStatus,
  OrderStatus,
  PaymentIssueState,
  PaymentStatus,
  ReturnKind,
  ReturnRefundMode,
  ReturnState,
} from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { adminTransitionOrder, getAdminOrder, requestOrderRefund } from "@/server/admin/orders";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
  stockOf,
} from "@/server/inventory/__tests__/checkout-fixtures";
import { LOOKUP_NOT_FOUND_MESSAGE } from "@/server/orders/lookup";
import { resolvePaymentIssues } from "@/server/payments/late-payment";
import {
  RazorpayApiError,
  type RazorpayClient,
  type RazorpayOrder,
  type RazorpayPayment,
  type RazorpayPaymentDetail,
  type RazorpayRefund,
  type RazorpayRefundClient,
} from "@/server/payments/razorpay";
import { reconcileClosedOrders } from "@/server/payments/reconcile";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";
import { exportAccountData } from "@/server/privacy/export";

import { RETURN_WINDOW_DAYS } from "../policy";
import {
  createReturnRequest,
  decideReturn,
  dispatchReplacement,
  listReturnsAsGuest,
  listReturnsNeedingAction,
  receiveReturn,
  receiveRto,
  recordManualRefund,
  refundReturn,
  requestReturnAsGuest,
} from "../service";

/**
 * Plan §5 Phase 10 Testing Requirements for returns, exchanges and RTO,
 * against a real Postgres, with orders made by a real verified capture:
 * return → approval → refund keeps order, payment and stock consistent;
 * RTO restocks correctly; refunds never exceed the capture; the guest path
 * is as enumeration-resistant as the order lookup.
 */

const SECRET = "whsec_returns_fixture";
const PRICE = 999_500;
const EMAIL = "buyer@example.com";
const ACTOR = `admin:${randomUUID()}`;
const FAST = { minDurationMs: 0 };
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const auditEntityIds: string[] = [];

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

/** Razorpay's refund API as the late-payment tests model it: idempotent by key, never above the captured amount. */
class FakeRefunds implements RazorpayRefundClient {
  readonly payments = new Map<string, RazorpayPaymentDetail>();
  readonly refunds = new Map<string, RazorpayRefund[]>();
  private readonly byKey = new Map<string, RazorpayRefund>();
  captured(id: string, amount: number) {
    this.payments.set(id, { id, order_id: null, amount, currency: "INR", status: "captured", amount_refunded: 0, refund_status: null });
  }
  async fetchPayment(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    return { ...payment };
  }
  async listPaymentRefunds(paymentId: string) {
    return [...(this.refunds.get(paymentId) ?? [])];
  }
  async createRefund(input: { paymentId: string; amountPaise: number; receipt: string; idempotencyKey: string }) {
    const previous = this.byKey.get(input.idempotencyKey);
    if (previous) return { ...previous };
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    if (payment.amount_refunded + input.amountPaise > payment.amount) {
      throw new RazorpayApiError(400, "The refund amount provided is greater than amount captured");
    }
    const refund: RazorpayRefund = {
      id: `rfnd_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      payment_id: input.paymentId,
      amount: input.amountPaise,
      currency: "INR",
      status: "processed",
      receipt: input.receipt,
    };
    this.byKey.set(input.idempotencyKey, refund);
    this.refunds.set(input.paymentId, [...(this.refunds.get(input.paymentId) ?? []), refund]);
    payment.amount_refunded += input.amountPaise;
    payment.status = "refunded";
    return { ...refund };
  }
}

interface Placed {
  orderId: string;
  orderNumber: string;
  providerPaymentId: string;
  totalPaise: number;
  lines: { variantId: string; sku: string; quantity: number }[];
}

/** A real order: reserve → Razorpay order → verified `payment.captured` webhook → order. */
async function placedOrder(lines: { quantity: number; stock?: number }[] = [{ quantity: 1 }], shippingPaise = 0): Promise<Placed> {
  const made = [];
  for (const line of lines) {
    const variantId = await stockedVariant(fixtures, line.stock ?? 5, PRICE);
    const { sku } = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { sku: true } });
    made.push({ variantId, sku, quantity: line.quantity });
  }
  const totalPaise = made.reduce((sum, line) => sum + PRICE * line.quantity, 0) + shippingPaise;
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: made.map(({ variantId, quantity }) => ({ variantId, quantity })),
    totalPaise,
  });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, new FakeRazorpay());
  const providerPaymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: providerPaymentId, order_id: razorpayOrderId, amount: totalPaise, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { id: true, orderNumber: true } });
  auditEntityIds.push(order.id, ...made.map((line) => line.variantId));
  return { orderId: order.id, orderNumber: order.orderNumber, providerPaymentId, totalPaise, lines: made };
}

async function ship(order: Placed) {
  await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });
  await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: `AWB${Date.now()}` });
}

async function delivered(lines?: { quantity: number; stock?: number }[], shippingPaise = 0): Promise<Placed> {
  const order = await placedOrder(lines, shippingPaise);
  await ship(order);
  await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.delivered });
  return order;
}

/** Another size of the same product (same colourway), with its own stock. */
async function siblingSize(variantId: string, sizeLabel: string, stock: number, pricePaise = PRICE): Promise<string> {
  const original = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { productId: true } });
  const id = randomUUID();
  await prisma.productVariant.create({
    data: {
      id,
      productId: original.productId,
      sku: `TEST-${id.slice(0, 8).toUpperCase()}`,
      sizeLabel,
      colorway: "Test",
      pricePaise,
      weightGrams: 100,
      position: 1,
      status: CatalogStatus.active,
    },
    select: { id: true },
  });
  await prisma.inventory.create({ data: { variantId: id, quantityOnHand: stock, quantityReserved: 0 }, select: { variantId: true } });
  auditEntityIds.push(id);
  return id;
}

const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${randomUUID()}`;

function guestBody(order: Placed, extra: Record<string, unknown> = {}) {
  return { orderNumber: order.orderNumber, email: EMAIL, sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", ...extra };
}

async function returnRow(id: string) {
  return prisma.returnRequest.findUniqueOrThrow({
    where: { id },
    select: { state: true, qcPassed: true, restockedAt: true, refundMode: true, refundDuePaise: true, refundReference: true, replacementAwb: true },
  });
}

async function auditActions(orderId: string) {
  const rows = await prisma.auditLog.findMany({ where: { entityId: orderId }, select: { action: true }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => row.action);
}

const approve = (id: string) => decideReturn(ACTOR, id, { decision: "approve" });
const receivePassed = (id: string, restock = true) => receiveReturn(ACTOR, id, { qcPassed: true, restock });
const confirm = (order: Placed) => ({ confirmOrderNumber: order.orderNumber, reason: "customer return" });

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: auditEntityIds } }, { actor: ACTOR }] } });
  auditEntityIds.length = 0;
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the guest request (task 7: no login, enumeration-resistant)", () => {
  it("a wrong email and an unknown order number fail identically, before anything about the order is checked", async () => {
    const order = await delivered();
    for (const body of [guestBody(order, { email: "someone@else.example" }), guestBody(order, { orderNumber: "VK-99999999" })]) {
      const error = await requestReturnAsGuest({ ip: ip(), body }, FAST).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as Error).message).toBe(LOOKUP_NOT_FOUND_MESSAGE);
    }
    // An order that is not delivered yet is only revealed to its owner.
    const shipped = await placedOrder();
    await expect(
      requestReturnAsGuest({ ip: ip(), body: guestBody(shipped, { email: "someone@else.example" }) }, FAST),
    ).rejects.toThrow(LOOKUP_NOT_FOUND_MESSAGE);
    expect(await prisma.returnRequest.count({ where: { orderId: { in: [order.orderId, shipped.orderId] } } })).toBe(0);
  });

  it("holds every response to the lookup's time floor", async () => {
    const order = await delivered();
    const started = Date.now();
    await expect(
      requestReturnAsGuest({ ip: ip(), body: guestBody(order, { email: "x@y.example" }) }, { minDurationMs: 300 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(Date.now() - started).toBeGreaterThanOrEqual(295);
  });

  it("rejects malformed bodies, free text and an exchange without a size", async () => {
    const order = await delivered();
    for (const body of [
      { ...guestBody(order), note: "free text is not accepted" },
      guestBody(order, { reason: "undelivered" }),
      guestBody(order, { kind: "rto" }),
      guestBody(order, { quantity: 0 }),
      guestBody(order, { kind: "exchange" }),
      guestBody(order, { exchangeSize: "IN 9" }),
    ]) {
      await expect(requestReturnAsGuest({ ip: ip(), body }, FAST)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("records the request, and the guest can read its status", async () => {
    const order = await delivered();
    const created = await requestReturnAsGuest({ ip: ip(), body: guestBody(order) }, FAST);
    expect(created).toMatchObject({ kind: "return", state: "requested", sku: order.lines[0]!.sku, quantity: 1, refund: null });
    const listed = await listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: EMAIL } }, FAST);
    expect(listed.returns).toEqual([created]);
    expect(listed.open).toBe(true);
    expect(listed.windowClosesAt).not.toBeNull();
    expect(listed.lines).toEqual([
      expect.objectContaining({ sku: order.lines[0]!.sku, availableUnits: 0, hasOpenRequest: true, exchangeSizes: [] }),
    ]);
    await expect(
      listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: "x@y.example" } }, FAST),
    ).rejects.toThrow(LOOKUP_NOT_FOUND_MESSAGE);
  });
});

describe("eligibility", () => {
  it("only a delivered order, only within 30 days of delivery", async () => {
    const shipped = await placedOrder();
    await ship(shipped);
    await expect(
      createReturnRequest(shipped.orderNumber, { sku: shipped.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" }),
    ).rejects.toThrow("open once an order is delivered");

    const order = await delivered();
    const request = { sku: order.lines[0]!.sku, quantity: 1, kind: "return" as const, reason: "size_fit" as const, requestedBy: "guest" };
    const deliveredAt = await prisma.orderStatusHistory.findFirstOrThrow({
      where: { orderId: order.orderId, toStatus: OrderStatus.delivered },
      select: { createdAt: true },
    });
    const day = 24 * 60 * 60 * 1000;
    const late = new Date(deliveredAt.createdAt.getTime() + RETURN_WINDOW_DAYS * day + 1000);
    await expect(createReturnRequest(order.orderNumber, request, late)).rejects.toThrow("return window");
    const lastDay = new Date(deliveredAt.createdAt.getTime() + RETURN_WINDOW_DAYS * day - 1000);
    await expect(createReturnRequest(order.orderNumber, request, lastDay)).resolves.toMatchObject({ state: "requested" });
  });

  it("an item not in the order is a 404", async () => {
    const order = await delivered();
    await expect(
      createReturnRequest(order.orderNumber, { sku: "TEST-NOPE", quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("quantity and duplicate guards", () => {
  it("never claims more units than were bought; one open request per item; a rejected request frees its units", async () => {
    const order = await delivered([{ quantity: 2 }]);
    const sku = order.lines[0]!.sku;
    const ask = (quantity: number) => createReturnRequest(order.orderNumber, { sku, quantity, kind: "return", reason: "size_fit", requestedBy: "guest" });

    await expect(ask(3)).rejects.toThrow("Only 2 unit(s)");
    const first = await ask(1);
    await expect(ask(1)).rejects.toThrow("already open");
    await decideReturn(ACTOR, first.id, { decision: "reject" });
    const second = await ask(2);
    await approve(second.id);
    await receivePassed(second.id, false);
    await refundReturn(ACTOR, second.id, confirm(order));
    await expect(ask(1)).rejects.toThrow("can no longer be returned"); // the whole order came back
  });

  it("two concurrent requests for the same item: exactly one is recorded", async () => {
    const order = await delivered([{ quantity: 1 }]);
    const sku = order.lines[0]!.sku;
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => createReturnRequest(order.orderNumber, { sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(ConflictError);
    }
    expect(await prisma.returnRequest.count({ where: { orderId: order.orderId } })).toBe(1);
  });

  it("the database refuses over-claiming even when the application check is bypassed", async () => {
    const order = await delivered([{ quantity: 1 }]);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId }, select: { id: true } });
    await prisma.returnRequest.create({
      data: { orderId: order.orderId, orderItemId: item.id, kind: ReturnKind.return, reason: "size_fit", quantity: 1, requestedBy: "test", state: ReturnState.completed },
      select: { id: true },
    });
    await expect(
      prisma.returnRequest.create({
        data: { orderId: order.orderId, orderItemId: item.id, kind: ReturnKind.return, reason: "size_fit", quantity: 1, requestedBy: "test" },
        select: { id: true },
      }),
    ).rejects.toThrow(/already claimed/);
  });
});

describe("return → approval → receipt → refund (whole order)", () => {
  it("restocks once, moves the order to returned, queues exactly the captured amount, and the refund job settles it", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 2 }]);
    const [a, b] = order.lines;
    const stockBefore = [await stockOf(a!.variantId), await stockOf(b!.variantId)];
    const requests = [];
    for (const line of order.lines) {
      requests.push(
        await createReturnRequest(order.orderNumber, { sku: line.sku, quantity: line.quantity, kind: "return", reason: "size_fit", requestedBy: "guest" }),
      );
    }
    for (const request of requests) {
      await approve(request.id);
      await receivePassed(request.id);
    }
    expect((await stockOf(a!.variantId)).quantityOnHand).toBe(stockBefore[0]!.quantityOnHand + 1);
    expect((await stockOf(b!.variantId)).quantityOnHand).toBe(stockBefore[1]!.quantityOnHand + 2);

    // Receiving again is refused before any stock moves.
    await expect(receivePassed(requests[0]!.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await stockOf(a!.variantId)).quantityOnHand).toBe(stockBefore[0]!.quantityOnHand + 1);

    await expect(refundReturn(ACTOR, requests[0]!.id, { ...confirm(order), confirmOrderNumber: "VK-1" })).rejects.toBeInstanceOf(ValidationError);
    await expect(refundReturn(ACTOR, requests[0]!.id, confirm(order))).resolves.toEqual({
      mode: ReturnRefundMode.full_order_queued,
      amountPaise: order.totalPaise,
    });
    for (const request of requests) {
      expect(await returnRow(request.id)).toMatchObject({ state: ReturnState.completed, refundMode: ReturnRefundMode.full_order_queued });
    }
    const issues = await prisma.paymentIssue.findMany({
      where: { providerPaymentId: order.providerPaymentId },
      select: { state: true, amountPaise: true, reason: true },
    });
    expect(issues).toEqual([{ state: PaymentIssueState.open, amountPaise: order.totalPaise, reason: "admin_refund" }]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, select: { status: true } })).status).toBe(OrderStatus.returned);
    await expect(refundReturn(ACTOR, requests[1]!.id, confirm(order))).rejects.toBeInstanceOf(ConflictError);
    expect(await auditActions(order.orderId)).toEqual(
      expect.arrayContaining(["return.approve", "return.receive", "order.refund"]),
    );

    const refunds = new FakeRefunds();
    refunds.captured(order.providerPaymentId, order.totalPaise);
    await resolvePaymentIssues(refunds);
    const settled = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      select: { status: true, payment: { select: { status: true } } },
    });
    expect(settled).toEqual({ status: OrderStatus.refunded, payment: { status: PaymentStatus.refunded } });
    expect(refunds.refunds.get(order.providerPaymentId)?.map((refund) => refund.amount)).toEqual([order.totalPaise]);
    const seen = await listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: EMAIL } }, FAST);
    expect(seen.returns.map((row) => row.refund?.status)).toEqual(["refunded", "refunded"]);
    expect(seen.open).toBe(false);
  });

  it("two concurrent receipts restock once", async () => {
    const order = await delivered([{ quantity: 2 }]);
    const line = order.lines[0]!;
    const before = (await stockOf(line.variantId)).quantityOnHand;
    const request = await createReturnRequest(order.orderNumber, { sku: line.sku, quantity: 2, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(request.id);
    const results = await Promise.allSettled([receivePassed(request.id), receivePassed(request.id), receivePassed(request.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(line.variantId)).quantityOnHand).toBe(before + 2);
    const restocks = await prisma.auditLog.count({ where: { entityId: line.variantId, action: "inventory.adjust" } });
    expect(restocks).toBe(1);
  });

  it("two concurrent refunds queue one", async () => {
    const order = await delivered();
    const request = await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(request.id);
    await receivePassed(request.id);
    const results = await Promise.allSettled([refundReturn(ACTOR, request.id, confirm(order)), refundReturn(ACTOR, request.id, confirm(order))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.paymentIssue.count({ where: { providerPaymentId: order.providerPaymentId } })).toBe(1);
  });

  it("a failed quality check closes the return with no refund and no restock", async () => {
    const order = await delivered();
    const line = order.lines[0]!;
    const before = (await stockOf(line.variantId)).quantityOnHand;
    const request = await createReturnRequest(order.orderNumber, { sku: line.sku, quantity: 1, kind: "return", reason: "defective", requestedBy: "guest" });
    await approve(request.id);
    await expect(receiveReturn(ACTOR, request.id, { qcPassed: false, restock: false })).resolves.toEqual({ state: ReturnState.completed, restocked: false });
    expect((await stockOf(line.variantId)).quantityOnHand).toBe(before);
    await expect(refundReturn(ACTOR, request.id, confirm(order))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("partial returns: refunds never exceed the capture", () => {
  it("records the line amount as due, leaves order and payment alone, and blocks a full refund on top", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }]);
    const first = await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(first.id);
    await receivePassed(first.id);
    await expect(refundReturn(ACTOR, first.id, confirm(order))).resolves.toEqual({ mode: ReturnRefundMode.manual_due, amountPaise: PRICE });
    expect(await returnRow(first.id)).toMatchObject({ state: ReturnState.received, refundMode: ReturnRefundMode.manual_due, refundDuePaise: PRICE });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, select: { status: true, payment: { select: { status: true } } } });
    expect(after).toEqual({ status: OrderStatus.delivered, payment: { status: PaymentStatus.captured } });
    expect(await prisma.paymentIssue.count({ where: { providerPaymentId: order.providerPaymentId } })).toBe(0);

    await expect(requestOrderRefund(ACTOR, order.orderNumber, confirm(order))).rejects.toThrow("partial refund");
    expect((await getAdminOrder(order.orderNumber)).refundable).toBe(false);
    expect((await listReturnsNeedingAction()).find((row) => row.id === first.id)).toMatchObject({ refundDuePaise: PRICE });

    await expect(recordManualRefund(ACTOR, first.id, { confirmOrderNumber: order.orderNumber, refundId: "rfnd_ABC123xyz" })).resolves.toEqual({
      state: ReturnState.completed,
    });
    // The customer sees it as recorded by us, never as a confirmed refund.
    const seen = await listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: EMAIL } }, FAST);
    expect(seen.returns.find((row) => row.id === first.id)?.refund).toEqual({ amountPaise: PRICE, status: "recorded" });
    await expect(recordManualRefund(ACTOR, first.id, { confirmOrderNumber: order.orderNumber, refundId: "rfnd_ABC123xyz" })).rejects.toBeInstanceOf(ConflictError);

    // The second line, later: due again, never a full refund of the whole capture.
    const second = await createReturnRequest(order.orderNumber, { sku: order.lines[1]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(second.id);
    await receivePassed(second.id);
    await expect(refundReturn(ACTOR, second.id, confirm(order))).resolves.toEqual({ mode: ReturnRefundMode.manual_due, amountPaise: PRICE });
    await expect(recordManualRefund(ACTOR, second.id, { confirmOrderNumber: order.orderNumber, refundId: "rfnd_ABC123xyz" })).rejects.toThrow("already recorded");
    const recorded = await prisma.returnRequest.aggregate({ where: { orderId: order.orderId }, _sum: { refundDuePaise: true } });
    expect(recorded._sum.refundDuePaise).toBe(order.totalPaise);
  });

  it("a partial refund Razorpay reports (webhook, reconciliation) never moves the payment or the order", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }]);
    const request = await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(request.id);
    await receivePassed(request.id);
    await refundReturn(ACTOR, request.id, confirm(order));
    const payment = await prisma.payment.findFirstOrThrow({
      where: { providerPaymentId: order.providerPaymentId },
      select: { providerOrderId: true },
    });

    // The dashboard refund's signed webhook, for the line amount only.
    const rawBody = JSON.stringify({
      event: "refund.processed",
      payload: {
        payment: { entity: { id: order.providerPaymentId, order_id: payment.providerOrderId, amount: order.totalPaise, currency: "INR", status: "refunded" } },
        refund: { entity: { id: "rfnd_PARTIAL0001", payment_id: order.providerPaymentId, amount: PRICE, status: "processed" } },
      },
    });
    const eventId = `evt_${randomUUID()}`;
    eventIds.push(eventId);
    await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });

    // Reconciliation reads Razorpay's payment summary, which reads "refunded" after any refund.
    const summary: RazorpayPayment = {
      id: order.providerPaymentId,
      order_id: payment.providerOrderId,
      amount: order.totalPaise,
      currency: "INR",
      status: "refunded",
    };
    const reporting: RazorpayClient = {
      createOrder: async () => {
        throw new Error("not used");
      },
      findOrderByReceipt: async () => null,
      listOrderPayments: async () => [summary],
    };
    await reconcileClosedOrders(reporting);

    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      select: { status: true, payment: { select: { status: true } } },
    });
    expect(after).toEqual({ status: OrderStatus.delivered, payment: { status: PaymentStatus.captured } });
    expect(await prisma.paymentIssue.count({ where: { providerPaymentId: order.providerPaymentId } })).toBe(0);
  });

  it("an operator cannot mark the order returned by hand while its returns are in progress", async () => {
    const order = await delivered();
    const request = await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await expect(adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.returned })).rejects.toThrow("returns in progress");
    await decideReturn(ACTOR, request.id, { decision: "reject" });
    await expect(adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.returned })).resolves.toEqual({
      changed: true,
      status: OrderStatus.returned,
    });
  });

  it("after one line is refunded by hand, the rest coming back never triggers the full refund", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }]);
    const [a, b, c] = order.lines;
    const ask = (sku: string) => createReturnRequest(order.orderNumber, { sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    const first = await ask(a!.sku);
    await approve(first.id);
    await receivePassed(first.id);
    await expect(refundReturn(ACTOR, first.id, confirm(order))).resolves.toMatchObject({ mode: ReturnRefundMode.manual_due });

    const rest = [await ask(b!.sku), await ask(c!.sku)];
    for (const request of rest) {
      await approve(request.id);
      await receivePassed(request.id);
    }
    // Every unit is now back, but one line was already refunded: still line by line.
    for (const request of rest) {
      await expect(refundReturn(ACTOR, request.id, confirm(order))).resolves.toEqual({ mode: ReturnRefundMode.manual_due, amountPaise: PRICE });
    }
    const recorded = await prisma.returnRequest.aggregate({ where: { orderId: order.orderId }, _sum: { refundDuePaise: true } });
    expect(recorded._sum.refundDuePaise).toBeLessThanOrEqual(order.totalPaise);
    expect(await prisma.returnRequest.count({ where: { orderId: order.orderId, refundMode: ReturnRefundMode.full_order_queued } })).toBe(0);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId }, select: { status: true } });
    expect(after.status).toBe(OrderStatus.delivered);
    expect(await prisma.paymentIssue.count({ where: { providerPaymentId: order.providerPaymentId } })).toBe(0);
  });

  it("two concurrent refunds on different lines whose sum would pass the capture: exactly one is recorded", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }, { quantity: 1 }]);
    const [a, b, c] = order.lines;
    const ask = (sku: string) => createReturnRequest(order.orderNumber, { sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    const first = await ask(a!.sku);
    await approve(first.id);
    await receivePassed(first.id);
    await refundReturn(ACTOR, first.id, confirm(order));
    // Leave room for one more line, not two.
    await prisma.returnRequest.update({ where: { id: first.id }, data: { refundDuePaise: order.totalPaise - PRICE - 1 }, select: { id: true } });
    const rest = [await ask(b!.sku), await ask(c!.sku)];
    for (const request of rest) {
      await approve(request.id);
      await receivePassed(request.id);
    }
    const results = await Promise.allSettled(rest.map((request) => refundReturn(ACTOR, request.id, confirm(order))));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.status === "rejected" && String(refused.reason)).toContain("would exceed the captured");
    const recorded = await prisma.returnRequest.aggregate({ where: { orderId: order.orderId }, _sum: { refundDuePaise: true } });
    expect(recorded._sum.refundDuePaise).toBe(order.totalPaise - 1);
  });

  it("once the order's full refund is queued, no return on it can record another", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }]);
    const request = await createReturnRequest(order.orderNumber, { sku: order.lines[1]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(request.id);
    await receivePassed(request.id);
    await requestOrderRefund(ACTOR, order.orderNumber, confirm(order));
    await expect(refundReturn(ACTOR, request.id, confirm(order))).rejects.toThrow("already open");
    expect((await returnRow(request.id)).refundMode).toBeNull();
    expect(await prisma.paymentIssue.count({ where: { providerPaymentId: order.providerPaymentId } })).toBe(1);
  });

  it("refuses a refund that would take the recorded total past the captured amount", async () => {
    const order = await delivered([{ quantity: 1 }, { quantity: 1 }]);
    const [a, b] = order.lines;
    const first = await createReturnRequest(order.orderNumber, { sku: a!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(first.id);
    await receivePassed(first.id);
    await refundReturn(ACTOR, first.id, confirm(order));
    // Someone recorded a larger amount by hand.
    await prisma.returnRequest.update({ where: { id: first.id }, data: { refundDuePaise: order.totalPaise - 1 }, select: { id: true } });
    const second = await createReturnRequest(order.orderNumber, { sku: b!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(second.id);
    await receivePassed(second.id);
    await expect(refundReturn(ACTOR, second.id, confirm(order))).rejects.toThrow("would exceed the captured");
    expect((await returnRow(second.id)).refundMode).toBeNull();
  });

  it("an order that charged shipping is refunded line by line, not in full", async () => {
    const order = await delivered([{ quantity: 1 }], 15_000);
    const request = await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" });
    await approve(request.id);
    await receivePassed(request.id);
    await expect(refundReturn(ACTOR, request.id, confirm(order))).resolves.toEqual({ mode: ReturnRefundMode.manual_due, amountPaise: PRICE });
  });
});

describe("exchanges", () => {
  it("same product, same price, another size: ships after receipt, taking the replacement's stock under lock", async () => {
    const order = await delivered();
    const line = order.lines[0]!;
    await prisma.productVariant.update({ where: { id: line.variantId }, data: { sizeLabel: "IN 8" }, select: { id: true } });
    const nine = await siblingSize(line.variantId, "IN 9", 1);
    await siblingSize(line.variantId, "IN 10", 3, PRICE + 100);

    const base = { sku: line.sku, quantity: 1, kind: "exchange" as const, reason: "size_fit" as const, requestedBy: "guest" };
    await expect(createReturnRequest(order.orderNumber, { ...base, exchangeSize: "IN 12" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createReturnRequest(order.orderNumber, { ...base, exchangeSize: "IN 10" })).rejects.toThrow("priced differently");
    await expect(createReturnRequest(order.orderNumber, { ...base, exchangeSize: "IN 8" })).rejects.toBeInstanceOf(ValidationError);
    await siblingSize(line.variantId, "IN 11", 0);
    const offered = await listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: EMAIL } }, FAST);
    // In stock and same price only: not IN 10 (priced differently), not IN 11 (none left), not its own size.
    expect(offered.lines[0]?.exchangeSizes).toEqual(["IN 9"]);
    const request = await createReturnRequest(order.orderNumber, { ...base, exchangeSize: "IN 9" });
    expect(request).toMatchObject({ kind: "exchange", exchangeSize: "IN 9" });

    await approve(request.id);
    const shipment = { courier: "Delhivery", awb: "EXCH12345" };
    await expect(dispatchReplacement(ACTOR, request.id, shipment)).rejects.toBeInstanceOf(ConflictError); // not received yet
    await receivePassed(request.id);
    await expect(refundReturn(ACTOR, request.id, confirm(order))).rejects.toThrow("Only returns are refunded");

    await dispatchReplacement(ACTOR, request.id, shipment);
    expect((await stockOf(nine)).quantityOnHand).toBe(0);
    expect(await returnRow(request.id)).toMatchObject({ state: ReturnState.completed, replacementAwb: "EXCH12345" });
    await expect(dispatchReplacement(ACTOR, request.id, shipment)).rejects.toBeInstanceOf(ConflictError);
    expect((await stockOf(nine)).quantityOnHand).toBe(0);
  });

  it("a replacement size that sold out meanwhile is refused, not oversold", async () => {
    const order = await delivered();
    const line = order.lines[0]!;
    await prisma.productVariant.update({ where: { id: line.variantId }, data: { sizeLabel: "IN 8" }, select: { id: true } });
    const nine = await siblingSize(line.variantId, "IN 9", 1);
    const request = await createReturnRequest(order.orderNumber, { sku: line.sku, quantity: 1, kind: "exchange", reason: "size_fit", exchangeSize: "IN 9", requestedBy: "guest" });
    await approve(request.id);
    await receivePassed(request.id);
    await prisma.inventory.update({ where: { variantId: nine }, data: { quantityOnHand: 0 }, select: { variantId: true } });
    await expect(dispatchReplacement(ACTOR, request.id, { courier: "Delhivery", awb: "EXCH12345" })).rejects.toThrow("out of stock");
    expect(await returnRow(request.id)).toMatchObject({ state: ReturnState.received, replacementAwb: null });
  });
});

describe("failed delivery (task 6: RTO)", () => {
  it("records the receipt per item, restocks what passed, once; the full refund stays available", async () => {
    const order = await placedOrder([{ quantity: 1 }, { quantity: 2 }]);
    const [a, b] = order.lines;
    const before = [await stockOf(a!.variantId), await stockOf(b!.variantId)];
    await ship(order);
    const decisions = { items: [{ sku: a!.sku, qcPassed: true, restock: true }, { sku: b!.sku, qcPassed: false, restock: false }] };
    await expect(receiveRto(ACTOR, order.orderNumber, decisions)).rejects.toThrow("mark it rto");
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.rto });

    await expect(receiveRto(ACTOR, order.orderNumber, { items: [decisions.items[0]!] })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      receiveRto(ACTOR, order.orderNumber, { items: [{ sku: a!.sku, qcPassed: false, restock: true }, decisions.items[1]!] }),
    ).rejects.toBeInstanceOf(ValidationError);

    const results = await Promise.allSettled([receiveRto(ACTOR, order.orderNumber, decisions), receiveRto(ACTOR, order.orderNumber, decisions)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "fulfilled")).toMatchObject({ value: { restockedUnits: 1 } });
    expect((await stockOf(a!.variantId)).quantityOnHand).toBe(before[0]!.quantityOnHand + 1);
    expect((await stockOf(b!.variantId)).quantityOnHand).toBe(before[1]!.quantityOnHand);
    const rows = await prisma.returnRequest.findMany({
      where: { orderId: order.orderId },
      select: { kind: true, state: true, quantity: true, qcPassed: true, restockedAt: true },
      orderBy: { quantity: "asc" },
    });
    expect(rows).toMatchObject([
      { kind: ReturnKind.rto, state: ReturnState.completed, quantity: 1, qcPassed: true },
      { kind: ReturnKind.rto, state: ReturnState.completed, quantity: 2, qcPassed: false, restockedAt: null },
    ]);
    expect(await auditActions(order.orderId)).toContain("order.rto_received");

    // Customers cannot return an RTO order, and the RTO rows are not theirs to see.
    await expect(
      createReturnRequest(order.orderNumber, { sku: a!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: "guest" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await listReturnsAsGuest({ ip: ip(), body: { orderNumber: order.orderNumber, email: EMAIL } }, FAST)).toMatchObject({
      returns: [],
      open: false,
    });

    await expect(requestOrderRefund(ACTOR, order.orderNumber, confirm(order))).resolves.toEqual({ queued: true, amountPaise: order.totalPaise });
  });
});

describe("schema guarantees", () => {
  it("return_requests has row-level security on, like every other table", async () => {
    const [row] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'return_requests' AND relkind = 'r'
    `;
    expect(row?.relrowsecurity).toBe(true);
  });

  it("refuses a restock without a passed check, and a refund on an exchange", async () => {
    const order = await delivered();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.orderId }, select: { id: true } });
    const base = { orderId: order.orderId, orderItemId: item.id, reason: "size_fit" as const, quantity: 1, requestedBy: "test" };
    await expect(
      prisma.returnRequest.create({ data: { ...base, kind: ReturnKind.return, restockedAt: new Date() }, select: { id: true } }),
    ).rejects.toThrow(/return_requests_restock_needs_qc/);
    await expect(
      prisma.returnRequest.create({
        data: { ...base, kind: ReturnKind.return, refundMode: ReturnRefundMode.manual_due, refundDuePaise: 1, qcPassed: false },
        select: { id: true },
      }),
    ).rejects.toThrow(/return_requests_refund_shape/);
  });
});

describe("data-subject export", () => {
  it("includes an account's returns under each order", async () => {
    const order = await delivered();
    const user = await prisma.appUser.create({
      data: { id: randomUUID(), email: `returns-${randomUUID()}@example.com` },
      select: { id: true },
    });
    try {
      await prisma.order.update({ where: { id: order.orderId }, data: { userId: user.id }, select: { id: true } });
      await createReturnRequest(order.orderNumber, { sku: order.lines[0]!.sku, quantity: 1, kind: "return", reason: "size_fit", requestedBy: `user:${user.id}` });
      const exported = await exportAccountData(user.id);
      expect(exported.orders[0]?.returns).toEqual([
        expect.objectContaining({ kind: "return", sku: order.lines[0]!.sku, quantity: 1, reason: "size_fit", state: "requested" }),
      ]);
    } finally {
      await prisma.order.update({ where: { id: order.orderId }, data: { userId: null }, select: { id: true } });
      await prisma.appUser.delete({ where: { id: user.id } });
    }
  });
});
