import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  CheckoutPaymentMethod,
  OrderStatus,
  PaymentStatus,
  ReturnKind,
  ReturnRefundMode,
  ReturnState,
} from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";
import { enqueueOrderShipped } from "@/server/email/outbox";
import { transitionOrder } from "@/server/orders/create";
import { normalizeOrderNumber } from "@/server/orders/lookup";
import { isValidOrderTransition } from "@/server/orders/state-machine";
import { recordPaymentIssue } from "@/server/payments/payment-issues";

import { writeAudit } from "./audit";

/**
 * The admin order surface (plan §5 Phase 12, tasks 2–4, 6, 7; Phase 10,
 * task 3). Every mutation goes through the same state machine as the rest
 * of the system and writes its audit row in the same transaction.
 */

export const ADMIN_PAGE_SIZE = 50;

/**
 * What an operator may move an order to. `refunded` is deliberately absent:
 * an order becomes refunded only when a real refund of its payment is
 * observed (see {@link requestOrderRefund}), never by assertion.
 */
export const ADMIN_TARGET_STATUSES = [
  OrderStatus.preparing,
  OrderStatus.shipped,
  OrderStatus.delivered,
  OrderStatus.cancelled,
  OrderStatus.rto,
  OrderStatus.returned,
] as const;

export function adminNextStatuses(from: OrderStatus): OrderStatus[] {
  return ADMIN_TARGET_STATUSES.filter((to) => isValidOrderTransition(from, to));
}

function requireOrderNumber(input: string): string {
  const orderNumber = normalizeOrderNumber(input);
  if (!orderNumber) throw new NotFoundError("Order not found.");
  return orderNumber;
}

// ---------------------------------------------------------------- reads

export const listOrdersQuerySchema = z.object({
  status: z.enum(OrderStatus).optional(),
  method: z.enum(CheckoutPaymentMethod).optional(),
  /** An order number (`VK-10001` / `10001`) or a 6-digit PIN code. */
  q: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export interface AdminOrderRow {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: CheckoutPaymentMethod;
  totalPaise: number;
  placedAt: string;
  shipCity: string;
  shipPincode: string;
  itemCount: number;
  awb: string | null;
}

export async function listAdminOrders(
  query: z.infer<typeof listOrdersQuerySchema>,
): Promise<{ rows: AdminOrderRow[]; hasMore: boolean }> {
  const q = query.q || undefined;
  const orderNumber = q ? normalizeOrderNumber(q) : null;
  const pincode = q && /^\d{6}$/.test(q) ? q : null;
  if (q && !orderNumber && !pincode) return { rows: [], hasMore: false };

  const orders = await prisma.order.findMany({
    where: {
      status: query.status,
      paymentMethod: query.method,
      ...(orderNumber ? { orderNumber } : {}),
      ...(pincode ? { shipPincode: pincode } : {}),
    },
    select: {
      orderNumber: true,
      status: true,
      paymentMethod: true,
      totalPaise: true,
      placedAt: true,
      shipCity: true,
      shipPincode: true,
      awb: true,
      items: { select: { quantity: true } },
    },
    orderBy: { placedAt: "desc" },
    skip: (query.page - 1) * ADMIN_PAGE_SIZE,
    take: ADMIN_PAGE_SIZE + 1,
  });
  return {
    hasMore: orders.length > ADMIN_PAGE_SIZE,
    rows: orders.slice(0, ADMIN_PAGE_SIZE).map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      totalPaise: order.totalPaise,
      placedAt: order.placedAt.toISOString(),
      shipCity: order.shipCity,
      shipPincode: order.shipPincode,
      itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
      awb: order.awb,
    })),
  };
}

export async function getAdminOrder(orderNumberInput: string) {
  const orderNumber = requireOrderNumber(orderNumberInput);
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      placedAt: true,
      userId: true,
      shipCity: true,
      shipState: true,
      shipPincode: true,
      gstSplit: true,
      sellerState: true,
      subtotalPaise: true,
      taxPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      totalPaise: true,
      courier: true,
      awb: true,
      shippedAt: true,
      items: {
        select: {
          sku: true,
          productName: true,
          sizeLabel: true,
          colorway: true,
          hsnCode: true,
          gstRateBps: true,
          quantity: true,
          unitPricePaise: true,
          lineSubtotalPaise: true,
          lineTaxPaise: true,
        },
        orderBy: { id: "asc" },
      },
      history: {
        select: { fromStatus: true, toStatus: true, actor: true, note: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      emails: {
        select: { template: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      payment: {
        select: {
          id: true,
          status: true,
          amountPaise: true,
          currency: true,
          providerOrderId: true,
          providerPaymentId: true,
          issues: {
            select: { state: true, reason: true, providerPaymentId: true, amountPaise: true, refundId: true, lastError: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!order) throw new NotFoundError("Order not found.");
  const audit = await prisma.auditLog.findMany({
    where: { entity: "order", entityId: order.id },
    select: { actor: true, action: true, reason: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  // A full refund on top of a recorded partial (return) refund would exceed the capture.
  const partialRefunds = await prisma.returnRequest.count({
    where: { orderId: order.id, refundMode: ReturnRefundMode.manual_due },
  });
  const refundable = partialRefunds === 0 && canRequestRefund(order);
  return { ...order, audit, nextStatuses: adminNextStatuses(order.status), refundable };
}

export type AdminOrderDetail = Awaited<ReturnType<typeof getAdminOrder>>;

/**
 * Issues hang off the payment row but are keyed per Razorpay attempt: an
 * `additional_payment` / `bag_already_paid` issue for a *second* attempt
 * says nothing about the captured one this order was paid with.
 */
function canRequestRefund(order: {
  status: OrderStatus;
  payment: {
    status: PaymentStatus;
    providerPaymentId: string | null;
    issues: { providerPaymentId: string }[];
  } | null;
}): boolean {
  const payment = order.payment;
  return (
    order.status !== OrderStatus.refunded &&
    payment?.status === PaymentStatus.captured &&
    !!payment.providerPaymentId &&
    !payment.issues.some((issue) => issue.providerPaymentId === payment.providerPaymentId)
  );
}

// ---------------------------------------------------------------- PII reveal

export const revealSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** Name, phone, email and address of an order — returned only after the reveal itself is audit-logged (task 7). */
export async function revealOrderPii(actor: string, orderNumberInput: string, reason: string, requestId?: string) {
  const orderNumber = requireOrderNumber(orderNumberInput);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        contactEmailEnc: true,
        shipNameEnc: true,
        shipPhoneEnc: true,
        shipLine1Enc: true,
        shipLine2Enc: true,
        shipCity: true,
        shipState: true,
        shipPincode: true,
      },
    });
    if (!order) throw new NotFoundError("Order not found.");
    await writeAudit(tx, { actor, action: "pii.reveal", entity: "order", entityId: order.id, reason, requestId });
    return {
      email: decryptField(order.contactEmailEnc),
      name: decryptField(order.shipNameEnc),
      phone: decryptField(order.shipPhoneEnc),
      line1: decryptField(order.shipLine1Enc),
      line2: order.shipLine2Enc ? decryptField(order.shipLine2Enc) : null,
      city: order.shipCity,
      state: order.shipState,
      pincode: order.shipPincode,
    };
  });
}

// ---------------------------------------------------------------- transitions

export const transitionSchema = z
  .object({
    to: z.enum(ADMIN_TARGET_STATUSES),
    note: z.string().trim().max(300).optional(),
    courier: z.string().trim().min(1).max(60).optional(),
    awb: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,40}$/, "AWB must be 4–40 letters, digits or hyphens")
      .optional(),
  })
  .strict();

export async function adminTransitionOrder(
  actor: string,
  orderNumberInput: string,
  input: z.infer<typeof transitionSchema>,
  requestId?: string,
): Promise<{ changed: boolean; status: OrderStatus }> {
  const orderNumber = requireOrderNumber(orderNumberInput);
  const shipping = input.to === OrderStatus.shipped;
  if (shipping && (!input.courier || !input.awb)) {
    throw new ValidationError("Courier and AWB are required to mark an order shipped.");
  }
  if (!shipping && (input.courier || input.awb)) {
    throw new ValidationError("Courier and AWB are only recorded when an order ships.");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { orderNumber }, select: { id: true } });
    if (!order) throw new NotFoundError("Order not found.");
    // Locked here so `before` is exact; `transitionOrder` re-locks (a no-op
    // in this transaction), refuses illegal moves and writes history.
    const [before] = await tx.$queryRaw<{ status: OrderStatus }[]>`
      SELECT status FROM orders WHERE id = ${order.id}::uuid FOR UPDATE
    `;
    if (!before) throw new NotFoundError("Order not found.");
    if (input.to === OrderStatus.returned && before.status !== OrderStatus.returned) {
      // Returns in progress settle the order themselves (`src/server/returns/`);
      // marking it returned by hand would strand them.
      const open = await tx.returnRequest.count({
        where: {
          orderId: order.id,
          kind: { not: ReturnKind.rto },
          state: { in: [ReturnState.requested, ReturnState.approved, ReturnState.received] },
        },
      });
      if (open > 0) {
        throw new ConflictError("This order has returns in progress; finish them on this page instead.");
      }
    }
    const changed = await transitionOrder(tx, { orderId: order.id, to: input.to, actor, note: input.note });
    if (!changed) return { changed: false, status: input.to };

    let shipment: { courier: string; awb: string } | undefined;
    if (shipping && input.courier && input.awb) {
      shipment = { courier: input.courier, awb: input.awb };
      await tx.order.update({
        where: { id: order.id },
        data: { ...shipment, shippedAt: new Date() },
        select: { id: true },
      });
      await enqueueOrderShipped(tx, order.id);
    }
    await writeAudit(tx, {
      actor,
      action: "order.transition",
      entity: "order",
      entityId: order.id,
      before: { status: before.status },
      after: { status: input.to, ...(shipment ?? {}) },
      reason: input.note,
      requestId,
    });
    return { changed: true, status: input.to };
  });
}

// ---------------------------------------------------------------- refunds

export const refundSchema = z
  .object({
    /** Second confirmation (task 6): the operator retypes the order number. */
    confirmOrderNumber: z.string().trim().min(1).max(20),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const ADMIN_REFUND_REASON = "admin_refund";

/**
 * Queues a **full** refund of an order's captured payment (task 6).
 *
 * It opens a `payment_issues` row — the same durable, idempotent refund
 * path late payments use (`late-payment.ts`): the maintenance job refunds
 * exactly the captured amount under a stable idempotency key, adopts its
 * own refund after a crash, and closes the issue (payment → `refunded`,
 * order → `refunded`) only when Razorpay lists processed refunds covering
 * it. So the cap at the captured amount holds by construction, no network
 * call runs here, and a double submit queues one refund.
 *
 * Partial refunds are not supported at launch (the order model has no
 * partially-refunded state); they go through the Razorpay dashboard and
 * land in `manual_review`.
 *
 * Lock order: payment → order, as every refund path.
 */
export async function requestOrderRefund(
  actor: string,
  orderNumberInput: string,
  input: z.infer<typeof refundSchema>,
  requestId?: string,
): Promise<{ queued: true; amountPaise: number }> {
  const orderNumber = requireOrderNumber(orderNumberInput);
  if (normalizeOrderNumber(input.confirmOrderNumber) !== orderNumber) {
    throw new ValidationError("The confirmation does not match this order number.");
  }
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber },
      select: { id: true, paymentId: true },
    });
    if (!order) throw new NotFoundError("Order not found.");
    return queueFullOrderRefund(tx, { orderId: order.id, paymentId: order.paymentId, actor, reason: input.reason, requestId });
  });
}

/**
 * The refund queueing itself, in the caller's transaction — shared with a
 * whole-order return (`src/server/returns/`). Locks payment → order, checks
 * the payment is captured with no issue yet and that no partial (return)
 * refund has been recorded against the order, then opens the issue and
 * writes the audit row.
 */
export async function queueFullOrderRefund(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    paymentId: string | null;
    actor: string;
    reason: string;
    requestId?: string;
    /** Extra audit context, e.g. the returns it settles. Never PII. */
    context?: Record<string, Prisma.InputJsonValue>;
  },
): Promise<{ queued: true; amountPaise: number }> {
  if (!input.paymentId) throw new ConflictError("This order has no online payment to refund.");

  const [payment] = await tx.$queryRaw<
    { status: PaymentStatus; provider_payment_id: string | null; amount_paise: number; currency: string }[]
  >`
    SELECT status, provider_payment_id, amount_paise, currency FROM payments
     WHERE id = ${input.paymentId}::uuid FOR UPDATE
  `;
  const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`
    SELECT status FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE
  `;
  if (!payment || !locked) throw new NotFoundError("Order not found.");
  if (locked.status === OrderStatus.refunded) throw new ConflictError("This order is already refunded.");
  if (payment.status !== PaymentStatus.captured || !payment.provider_payment_id) {
    throw new ConflictError(`The payment is "${payment.status}", not captured; nothing to refund.`);
  }
  const existing = await tx.paymentIssue.findUnique({
    where: { providerPaymentId: payment.provider_payment_id },
    select: { state: true },
  });
  if (existing) throw new ConflictError(`A refund is already ${existing.state.replaceAll("_", " ")} for this payment.`);
  // A full refund on top of a partial one would exceed the captured amount.
  const partial = await tx.returnRequest.count({
    where: { orderId: input.orderId, refundMode: ReturnRefundMode.manual_due },
  });
  if (partial > 0) {
    throw new ConflictError(
      "A partial refund is recorded against this order's returns; refund any remainder in the Razorpay dashboard.",
    );
  }

  await recordPaymentIssue(tx, {
    paymentId: input.paymentId,
    providerPaymentId: payment.provider_payment_id,
    amountPaise: payment.amount_paise,
    currency: payment.currency,
    reason: ADMIN_REFUND_REASON,
  });
  await writeAudit(tx, {
    actor: input.actor,
    action: "order.refund",
    entity: "order",
    entityId: input.orderId,
    before: { status: locked.status, paymentStatus: payment.status },
    after: { refundQueuedPaise: payment.amount_paise, ...(input.context ?? {}) },
    reason: input.reason,
    requestId: input.requestId,
  });
  return { queued: true as const, amountPaise: payment.amount_paise };
}
