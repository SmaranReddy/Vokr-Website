import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  CatalogStatus,
  OrderStatus,
  PaymentStatus,
  ReturnKind,
  ReturnReason,
  ReturnRefundMode,
  ReturnState,
} from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { applyStockChange } from "@/server/admin/inventory";
import { queueFullOrderRefund } from "@/server/admin/orders";
import { writeAudit } from "@/server/admin/audit";
import { invalidateCatalogCache } from "@/server/catalog/service";
import { prisma } from "@/server/db/client";
import { runLockingTransaction } from "@/server/inventory/transaction";
import { transitionOrder } from "@/server/orders/create";
import { LOOKUP_RATE_LIMITED_MESSAGE, lookupGuestOrder, normalizeOrderNumber } from "@/server/orders/lookup";
import { consumeRateLimit } from "@/server/rate-limit";

import {
  assertWithinReturnWindow,
  claimedUnits,
  lineRefundPaise,
  OPEN_RETURN_STATES,
  returnWindowClosesAt,
  wholeOrderReturn,
} from "./policy";

/**
 * Returns, exchanges and failed deliveries (plan §5 Phase 10, tasks 1, 6,
 * 7). The customer asks with the order number and email — the guest
 * lookup's own limits, uniform errors and timing floor — and an operator
 * moves each request on from the admin order page.
 *
 * Every mutation runs in one locking transaction that takes, in order,
 * **payment → order → return rows → inventory (by variant id)** — the
 * refund path's payment → order, extended — and writes its audit row in
 * the same transaction. Stock comes back only through the audited
 * adjustment step, at most once per row. No network call runs here:
 * a whole-order refund is queued on the existing `payment_issues` path,
 * anything less is recorded as due for an operator to make by hand.
 */

export const RETURN_REQUEST_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

const CUSTOMER_REASONS = [
  ReturnReason.size_fit,
  ReturnReason.defective,
  ReturnReason.not_as_described,
  ReturnReason.changed_mind,
  ReturnReason.other,
] as const;

const credentials = { orderNumber: z.string().max(40), email: z.string().max(254) };

export const returnRequestBodySchema = z
  .object({
    ...credentials,
    sku: z.string().trim().min(1).max(40),
    quantity: z.number().int().min(1).max(20),
    kind: z.enum([ReturnKind.return, ReturnKind.exchange]),
    reason: z.enum(CUSTOMER_REASONS),
    /** Exchange only: the size wanted instead, e.g. `IN 9`. */
    exchangeSize: z.string().trim().min(1).max(20).optional(),
  })
  .strict()
  .refine((body) => (body.kind === ReturnKind.exchange) === (body.exchangeSize !== undefined), {
    message: "An exchange needs the size you want instead; a return does not.",
  });

export const returnLookupBodySchema = z.object(credentials).strict();

// ---------------------------------------------------------------- views

const RETURN_VIEW_SELECT = {
  id: true,
  kind: true,
  state: true,
  reason: true,
  quantity: true,
  qcPassed: true,
  refundMode: true,
  refundDuePaise: true,
  refundReference: true,
  replacementCourier: true,
  replacementAwb: true,
  replacementDispatchedAt: true,
  createdAt: true,
  orderItem: { select: { sku: true, productName: true, sizeLabel: true, colorway: true } },
  requestedVariant: { select: { sizeLabel: true } },
  order: { select: { status: true } },
} as const;

type ReturnRow = Prisma.ReturnRequestGetPayload<{ select: typeof RETURN_VIEW_SELECT }>;

/** What the customer sees: no operator, no stock, no audit detail. */
export interface CustomerReturnView {
  id: string;
  kind: ReturnKind;
  state: ReturnState;
  reason: ReturnReason;
  sku: string;
  productName: string;
  sizeLabel: string;
  colorway: string;
  quantity: number;
  exchangeSize: string | null;
  requestedAt: string;
  /**
   * - `queued`: the order's full refund is queued; `refunded` once Razorpay
   *   confirmed it (the order itself moved to `refunded`).
   * - `due`: an operator still has to make the (partial) refund.
   * - `recorded`: an operator recorded the dashboard refund's id. Not read
   *   back from Razorpay, so never shown as a confirmed refund.
   */
  refund: { amountPaise: number; status: "queued" | "refunded" | "due" | "recorded" } | null;
  replacement: { courier: string; awb: string; dispatchedAt: string } | null;
}

export function toCustomerReturnView(row: ReturnRow): CustomerReturnView {
  let refund: CustomerReturnView["refund"] = null;
  if (row.refundMode && row.refundDuePaise !== null) {
    refund = {
      amountPaise: row.refundDuePaise,
      status:
        row.refundMode === ReturnRefundMode.full_order_queued
          ? row.order.status === OrderStatus.refunded
            ? "refunded"
            : "queued"
          : row.refundReference
            ? "recorded"
            : "due",
    };
  }
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    reason: row.reason,
    sku: row.orderItem.sku,
    productName: row.orderItem.productName,
    sizeLabel: row.orderItem.sizeLabel,
    colorway: row.orderItem.colorway,
    quantity: row.quantity,
    exchangeSize: row.requestedVariant?.sizeLabel ?? null,
    requestedAt: row.createdAt.toISOString(),
    refund,
    replacement:
      row.replacementAwb && row.replacementCourier && row.replacementDispatchedAt
        ? { courier: row.replacementCourier, awb: row.replacementAwb, dispatchedAt: row.replacementDispatchedAt.toISOString() }
        : null,
  };
}

// ---------------------------------------------------------------- customer

/**
 * `POST /api/returns/request`: the guest lookup proves the caller holds the
 * order number and email (same limits, uniform 404/429, timing floor);
 * then the request is checked and recorded under the order's lock.
 */
export async function requestReturnAsGuest(
  input: { ip: string; body: unknown },
  options: { minDurationMs?: number; now?: Date } = {},
): Promise<CustomerReturnView> {
  const parsed = returnRequestBodySchema.safeParse(input.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the return details.");
  }
  const limit = await consumeRateLimit({ key: `returns:request:ip:${input.ip}`, ...RETURN_REQUEST_LIMIT });
  if (!limit.allowed) throw new RateLimitError(LOOKUP_RATE_LIMITED_MESSAGE);

  const { orderNumber, email, ...request } = parsed.data;
  const order = await lookupGuestOrder({ ip: input.ip, body: { orderNumber, email } }, options);
  return createReturnRequest(order.orderNumber, { ...request, requestedBy: "guest" }, options.now);
}

/** What the request form may offer for one order line. Decided here, re-checked when the request is made. */
export interface ReturnableLine {
  sku: string;
  productName: string;
  sizeLabel: string;
  colorway: string;
  /** Units not yet returned or exchanged. */
  availableUnits: number;
  /** A request for this line is already open; no second one until it closes. */
  hasOpenRequest: boolean;
  /** Other sizes of the same shoe, same colour and price, in stock now. Stock is re-checked when the replacement ships. */
  exchangeSizes: string[];
}

export interface GuestReturns {
  returns: CustomerReturnView[];
  /** Whether new requests can be made now (delivered, inside the window). */
  open: boolean;
  /** The last day of the window, once the order is delivered. */
  windowClosesAt: string | null;
  lines: ReturnableLine[];
}

/** `POST /api/returns/lookup`: the order's returns and what can still be requested, behind the same guest lookup. */
export async function listReturnsAsGuest(
  input: { ip: string; body: unknown },
  options: { minDurationMs?: number; now?: Date } = {},
): Promise<GuestReturns> {
  const parsed = returnLookupBodySchema.safeParse(input.body);
  if (!parsed.success) throw new ValidationError("Enter your order number and email.");
  const found = await lookupGuestOrder({ ip: input.ip, body: parsed.data }, options);
  const order = await prisma.order.findUniqueOrThrow({
    where: { orderNumber: found.orderNumber },
    select: {
      status: true,
      history: { where: { toStatus: OrderStatus.delivered }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      items: {
        select: {
          sku: true,
          productName: true,
          sizeLabel: true,
          colorway: true,
          quantity: true,
          unitPricePaise: true,
          variant: { select: { id: true, productId: true, colorway: true } },
          returns: { select: { kind: true, state: true, quantity: true } },
        },
        orderBy: { id: "asc" },
      },
      returns: { where: { kind: { not: ReturnKind.rto } }, select: RETURN_VIEW_SELECT, orderBy: { createdAt: "asc" } },
    },
  });
  const deliveredAt = order.history[0]?.createdAt ?? null;
  let open = order.status === OrderStatus.delivered;
  try {
    if (open) assertWithinReturnWindow(deliveredAt, options.now ?? new Date());
  } catch {
    open = false;
  }

  const productIds = [...new Set(order.items.flatMap((item) => (item.variant ? [item.variant.productId] : [])))];
  const siblings = open && productIds.length > 0
    ? await prisma.productVariant.findMany({
        where: { productId: { in: productIds }, status: CatalogStatus.active },
        select: {
          id: true,
          productId: true,
          colorway: true,
          sizeLabel: true,
          pricePaise: true,
          position: true,
          inventory: { select: { quantityOnHand: true, quantityReserved: true } },
        },
        orderBy: { position: "asc" },
      })
    : [];

  return {
    returns: order.returns.map(toCustomerReturnView),
    open,
    windowClosesAt: deliveredAt ? returnWindowClosesAt(deliveredAt).toISOString() : null,
    lines: order.items.map((item) => ({
      sku: item.sku,
      productName: item.productName,
      sizeLabel: item.sizeLabel,
      colorway: item.colorway,
      availableUnits: item.quantity - claimedUnits(item.returns),
      hasOpenRequest: item.returns.some((row) => row.kind !== ReturnKind.rto && OPEN_RETURN_STATES.includes(row.state)),
      exchangeSizes: item.variant
        ? siblings
            .filter(
              (variant) =>
                variant.productId === item.variant!.productId &&
                variant.colorway === item.variant!.colorway &&
                variant.id !== item.variant!.id &&
                variant.pricePaise === item.unitPricePaise &&
                (variant.inventory?.quantityOnHand ?? 0) - (variant.inventory?.quantityReserved ?? 0) > 0,
            )
            .map((variant) => variant.sizeLabel)
        : [],
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Records a return or exchange request. Exported for the admin path and tests; customers go through {@link requestReturnAsGuest}. */
export async function createReturnRequest(
  orderNumber: string,
  input: {
    sku: string;
    quantity: number;
    kind: "return" | "exchange";
    reason: ReturnReason;
    exchangeSize?: string;
    requestedBy: string;
  },
  now: Date = new Date(),
  /** Set when an operator records the request: audited in the same transaction. */
  audit?: { actor: string; note?: string; requestId?: string },
): Promise<CustomerReturnView> {
  try {
    return await runLockingTransaction("returns.request", async (tx) => {
      const order = await tx.order.findUnique({ where: { orderNumber }, select: { id: true } });
      if (!order) throw new NotFoundError("Order not found.");
      const [locked] = await tx.$queryRaw<{ status: OrderStatus }[]>`
        SELECT status FROM orders WHERE id = ${order.id}::uuid FOR UPDATE
      `;
      if (!locked) throw new NotFoundError("Order not found.");
      if (locked.status !== OrderStatus.delivered) {
        throw new ConflictError(
          locked.status === OrderStatus.confirmed ||
            locked.status === OrderStatus.preparing ||
            locked.status === OrderStatus.shipped
            ? "Returns and exchanges open once an order is delivered."
            : "This order can no longer be returned or exchanged.",
        );
      }
      const delivered = await tx.orderStatusHistory.findFirst({
        where: { orderId: order.id, toStatus: OrderStatus.delivered },
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      assertWithinReturnWindow(delivered?.createdAt ?? null, now);

      const item = await tx.orderItem.findFirst({
        where: { orderId: order.id, sku: input.sku.toUpperCase() },
        select: {
          id: true,
          quantity: true,
          unitPricePaise: true,
          variant: { select: { id: true, productId: true, colorway: true } },
          returns: { select: { kind: true, state: true, quantity: true } },
        },
      });
      if (!item) throw new NotFoundError("That item isn't part of this order.");
      if (item.returns.some((row) => row.kind !== ReturnKind.rto && OPEN_RETURN_STATES.includes(row.state))) {
        throw new ConflictError("A return or exchange for this item is already open.");
      }
      const available = item.quantity - claimedUnits(item.returns);
      if (input.quantity > available) {
        throw new ConflictError(
          available === 0
            ? "Every unit of this item already has a return or exchange."
            : `Only ${available} unit(s) of this item can still be returned or exchanged.`,
        );
      }

      let requestedVariantId: string | null = null;
      if (input.kind === ReturnKind.exchange) {
        if (!item.variant) throw new ConflictError("This item can no longer be exchanged; request a return instead.");
        const target = await tx.productVariant.findFirst({
          where: {
            productId: item.variant.productId,
            colorway: item.variant.colorway,
            sizeLabel: input.exchangeSize,
            status: CatalogStatus.active,
          },
          select: { id: true, pricePaise: true },
        });
        if (!target) throw new NotFoundError("That size isn't available for this shoe.");
        if (target.id === item.variant.id) throw new ValidationError("Choose a different size to exchange for.");
        // A price difference would need a payment or a part refund, which
        // no published policy settles: return and reorder instead.
        if (target.pricePaise !== item.unitPricePaise) {
          throw new ConflictError("That size is priced differently now; please request a return and reorder.");
        }
        requestedVariantId = target.id;
      }

      const row = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          orderItemId: item.id,
          kind: input.kind,
          reason: input.reason,
          quantity: input.quantity,
          requestedVariantId,
          requestedBy: input.requestedBy,
        },
        select: RETURN_VIEW_SELECT,
      });
      if (audit) {
        await auditReturn(tx, {
          actor: audit.actor,
          action: "return.create",
          orderId: order.id,
          returnId: row.id,
          before: {},
          after: { kind: input.kind, quantity: input.quantity, reason: input.reason, exchangeSize: input.exchangeSize ?? null },
          reason: audit.note,
          requestId: audit.requestId,
        });
      }
      console.info(
        `[returns] requested return=${row.id} order=${order.id} kind=${input.kind} quantity=${input.quantity} by=${input.requestedBy}`,
      );
      return toCustomerReturnView(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("A return or exchange for this item is already open.");
    throw error;
  }
}

// ---------------------------------------------------------------- admin

/** The guest request's fields, minus the credentials: the operator is already authenticated. */
export const adminReturnRequestSchema = z
  .object({
    sku: z.string().trim().min(1).max(40),
    quantity: z.number().int().min(1).max(20),
    kind: z.enum([ReturnKind.return, ReturnKind.exchange]),
    reason: z.enum(CUSTOMER_REASONS),
    exchangeSize: z.string().trim().min(1).max(20).optional(),
    /** Why the operator is recording it (e.g. "customer emailed support"). */
    note: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine((body) => (body.kind === ReturnKind.exchange) === (body.exchangeSize !== undefined), {
    message: "An exchange needs the size wanted instead; a return does not.",
  });

/**
 * An operator records a request the customer made by email or phone. Same
 * checks as the customer's own (delivered, inside the window, units left,
 * one open request per item, same-price exchange), plus an audit row.
 */
export async function createReturnAsAdmin(
  actor: string,
  orderNumberInput: string,
  input: z.infer<typeof adminReturnRequestSchema>,
  requestId?: string,
): Promise<CustomerReturnView> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  if (!orderNumber) throw new NotFoundError("Order not found.");
  const { note, ...request } = input;
  return createReturnRequest(orderNumber, { ...request, requestedBy: actor }, new Date(), { actor, note, requestId });
}

export const decideReturnSchema = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional() })
  .strict();

export const receiveReturnSchema = z
  .object({
    qcPassed: z.boolean(),
    /** Put the units back into sellable stock. Only after a passed check. */
    restock: z.boolean(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((body) => body.qcPassed || !body.restock, { message: "Only items that pass the quality check can be restocked." });

export const dispatchReplacementSchema = z
  .object({
    courier: z.string().trim().min(1).max(60),
    awb: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{4,40}$/, "AWB must be 4–40 letters, digits or hyphens"),
  })
  .strict();

export const refundReturnSchema = z
  .object({
    /** Second confirmation: the operator retypes the order number. */
    confirmOrderNumber: z.string().trim().min(1).max(20),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const recordManualRefundSchema = z
  .object({
    confirmOrderNumber: z.string().trim().min(1).max(20),
    /** The Razorpay refund id from the dashboard, e.g. `rfnd_…`. */
    refundId: z.string().trim().regex(/^rfnd_[A-Za-z0-9]{6,40}$/, "Enter the Razorpay refund id (rfnd_…)"),
  })
  .strict();

export const rtoReceiveSchema = z
  .object({
    items: z
      .array(z.object({ sku: z.string().trim().min(1).max(40), qcPassed: z.boolean(), restock: z.boolean() }).strict())
      .min(1)
      .max(50),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

interface LockedReturn {
  id: string;
  order_id: string;
  order_item_id: string;
  kind: ReturnKind;
  state: ReturnState;
  quantity: number;
  qc_passed: boolean | null;
  refund_mode: ReturnRefundMode | null;
  refund_due_paise: number | null;
  refund_reference: string | null;
  requested_variant_id: string | null;
  replacement_awb: string | null;
}

async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const [order] = await tx.$queryRaw<{ id: string; status: OrderStatus; order_number: string }[]>`
    SELECT id, status, order_number FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `;
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

async function lockReturn(tx: Prisma.TransactionClient, returnId: string): Promise<LockedReturn> {
  const [row] = await tx.$queryRaw<LockedReturn[]>`
    SELECT id, order_id, order_item_id, kind, state, quantity, qc_passed, refund_mode, refund_due_paise,
           refund_reference, requested_variant_id, replacement_awb
      FROM return_requests WHERE id = ${returnId}::uuid FOR UPDATE
  `;
  if (!row) throw new NotFoundError("Return not found.");
  return row;
}

/** Order (then the row) locked, in the global order; the return's order id is read unlocked first and never changes. */
async function lockOrderAndReturn(tx: Prisma.TransactionClient, returnId: string) {
  const ref = await tx.returnRequest.findUnique({ where: { id: returnId }, select: { orderId: true } });
  if (!ref) throw new NotFoundError("Return not found.");
  const order = await lockOrder(tx, ref.orderId);
  const row = await lockReturn(tx, returnId);
  return { order, row };
}

function requireState(row: LockedReturn, ...allowed: ReturnState[]): void {
  if (!allowed.includes(row.state)) {
    throw new ConflictError(`This ${row.kind} is ${row.state}; that step is not available.`);
  }
}

function requireConfirmation(orderNumber: string, confirm: string): void {
  if (normalizeOrderNumber(confirm) !== orderNumber) {
    throw new ValidationError("The confirmation does not match this order number.");
  }
}

async function auditReturn(
  tx: Prisma.TransactionClient,
  entry: {
    actor: string;
    action: string;
    orderId: string;
    returnId: string;
    before: Prisma.InputJsonValue;
    after: Prisma.InputJsonValue;
    reason?: string;
    requestId?: string;
  },
) {
  // On the order, so the order page's audit trail shows it.
  await writeAudit(tx, {
    actor: entry.actor,
    action: entry.action,
    entity: "order",
    entityId: entry.orderId,
    before: { returnId: entry.returnId, ...(entry.before as object) },
    after: { returnId: entry.returnId, ...(entry.after as object) },
    reason: entry.reason,
    requestId: entry.requestId,
  });
}

/** `requested → approved | rejected`. */
export async function decideReturn(
  actor: string,
  returnId: string,
  input: z.infer<typeof decideReturnSchema>,
  requestId?: string,
): Promise<{ state: ReturnState }> {
  return runLockingTransaction("returns.decide", async (tx) => {
    const { order, row } = await lockOrderAndReturn(tx, returnId);
    requireState(row, ReturnState.requested);
    const state = input.decision === "approve" ? ReturnState.approved : ReturnState.rejected;
    await tx.returnRequest.update({
      where: { id: row.id },
      data: { state, decidedAt: new Date(), ...(state === ReturnState.rejected ? { completedAt: new Date() } : {}) },
      select: { id: true },
    });
    await auditReturn(tx, {
      actor,
      action: `return.${input.decision}`,
      orderId: order.id,
      returnId: row.id,
      before: { state: row.state },
      after: { state },
      reason: input.note,
      requestId,
    });
    return { state };
  });
}

/**
 * `approved → received`, with the quality check and the restock decision.
 * The state change is the restock's idempotency guard: a second submit
 * finds the row `received` and is refused before any stock moves. A failed
 * check closes a return or exchange without a refund or replacement; what
 * happens to the item then is an operator's conversation with the customer.
 */
export async function receiveReturn(
  actor: string,
  returnId: string,
  input: z.infer<typeof receiveReturnSchema>,
  requestId?: string,
): Promise<{ state: ReturnState; restocked: boolean }> {
  const result = await runLockingTransaction("returns.receive", async (tx) => {
    const { order, row } = await lockOrderAndReturn(tx, returnId);
    requireState(row, ReturnState.approved);
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: row.order_item_id }, select: { variantId: true } });
    if (input.restock && !item.variantId) {
      throw new ConflictError("This item's variant no longer exists; it cannot be restocked.");
    }
    const now = new Date();
    const state = input.qcPassed ? ReturnState.received : ReturnState.completed;
    await tx.returnRequest.update({
      where: { id: row.id },
      data: {
        state,
        qcPassed: input.qcPassed,
        receivedAt: now,
        ...(input.restock ? { restockedAt: now } : {}),
        ...(state === ReturnState.completed ? { completedAt: now } : {}),
      },
      select: { id: true },
    });
    if (input.restock && item.variantId) {
      await applyStockChange(tx, {
        variantId: item.variantId,
        delta: row.quantity,
        reason: `${row.kind} received for ${order.order_number}`,
        actor,
        requestId,
        context: { returnId: row.id },
      });
    }
    await auditReturn(tx, {
      actor,
      action: "return.receive",
      orderId: order.id,
      returnId: row.id,
      before: { state: row.state },
      after: { state, qcPassed: input.qcPassed, restocked: input.restock },
      reason: input.note,
      requestId,
    });
    return { state, restocked: input.restock };
  });
  if (result.restocked) invalidateCatalogCache();
  return result;
}

/**
 * Settles the money for a received, checked return (task 7 → task 8).
 *
 * - **Whole order back** (every unit, every line, nothing refunded yet, no
 *   shipping or COD fee charged): the order moves `delivered → returned`
 *   and the existing full refund is queued — the maintenance job refunds
 *   exactly the captured amount and moves the order to `refunded`.
 * - **Anything less:** the line amount is recorded as due (`manual_due`).
 *   An operator refunds it in the Razorpay dashboard and records the
 *   refund id. Recorded amounts never exceed the captured payment.
 *
 * Lock order: payment → order → returns.
 */
export async function refundReturn(
  actor: string,
  returnId: string,
  input: z.infer<typeof refundReturnSchema>,
  requestId?: string,
): Promise<{ mode: ReturnRefundMode; amountPaise: number }> {
  return runLockingTransaction("returns.refund", async (tx) => {
    const ref = await tx.returnRequest.findUnique({
      where: { id: returnId },
      select: { order: { select: { id: true, orderNumber: true, paymentId: true } } },
    });
    if (!ref) throw new NotFoundError("Return not found.");
    requireConfirmation(ref.order.orderNumber, input.confirmOrderNumber);
    if (!ref.order.paymentId) {
      // COD refunds go by bank transfer or store credit (terms §8): D11, and D1's ledger.
      throw new ConflictError("Refunds for cash-on-delivery orders are not built yet.");
    }
    const [payment] = await tx.$queryRaw<{ status: PaymentStatus; amount_paise: number; provider_payment_id: string | null }[]>`
      SELECT status, amount_paise, provider_payment_id FROM payments WHERE id = ${ref.order.paymentId}::uuid FOR UPDATE
    `;
    const order = await lockOrder(tx, ref.order.id);
    const row = await lockReturn(tx, returnId);
    if (!payment) throw new NotFoundError("Order not found.");
    if (row.kind !== ReturnKind.return) throw new ConflictError("Only returns are refunded; an exchange ships a replacement.");
    requireState(row, ReturnState.received);
    if (row.qc_passed !== true) throw new ConflictError("Only items that passed the quality check are refunded.");
    if (row.refund_mode) throw new ConflictError("A refund is already recorded for this return.");
    if (order.status !== OrderStatus.delivered) {
      throw new ConflictError(`The order is ${order.status}; refund it from the order's refund section instead.`);
    }
    if (payment.status !== PaymentStatus.captured || !payment.provider_payment_id) {
      throw new ConflictError(`The payment is "${payment.status}", not captured; nothing to refund.`);
    }
    const issue = await tx.paymentIssue.findUnique({
      where: { providerPaymentId: payment.provider_payment_id },
      select: { state: true },
    });
    if (issue) throw new ConflictError(`A refund is already ${issue.state.replaceAll("_", " ")} for this payment.`);

    // Every row of the order is locked before it is read or changed.
    await tx.$queryRaw`SELECT id FROM return_requests WHERE order_id = ${order.id}::uuid ORDER BY id FOR UPDATE`;
    const full = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        shippingPaise: true,
        codFeePaise: true,
        items: { select: { id: true, quantity: true, unitPricePaise: true } },
        returns: {
          select: { id: true, orderItemId: true, kind: true, state: true, quantity: true, qcPassed: true, refundMode: true, refundDuePaise: true },
        },
      },
    });
    const unitPrice = new Map(full.items.map((item) => [item.id, item.unitPricePaise]));
    const amountOf = (r: { orderItemId: string; quantity: number }) =>
      lineRefundPaise({ unitPricePaise: unitPrice.get(r.orderItemId) ?? 0 }, r.quantity);

    const settling = wholeOrderReturn(full, full.returns);
    if (settling && settling.some((r) => r.id === row.id)) {
      const total = settling.reduce((sum, r) => sum + amountOf(r), 0);
      if (total === payment.amount_paise) {
        const now = new Date();
        for (const r of settling) {
          await tx.returnRequest.update({
            where: { id: r.id },
            data: { refundMode: ReturnRefundMode.full_order_queued, refundDuePaise: amountOf(r), state: ReturnState.completed, completedAt: now },
            select: { id: true },
          });
        }
        await transitionOrder(tx, { orderId: order.id, to: OrderStatus.returned, actor, note: "every item returned" });
        await queueFullOrderRefund(tx, {
          orderId: order.id,
          paymentId: ref.order.paymentId,
          actor,
          reason: input.reason,
          requestId,
          context: { returnIds: settling.map((r) => r.id) },
        });
        return { mode: ReturnRefundMode.full_order_queued, amountPaise: total };
      }
      // Lines that do not add up to the charge: never guess which is right.
      console.error(`[returns] order=${order.id} lines ${total} != captured ${payment.amount_paise}; refunding line by line`);
    }

    const due = amountOf({ orderItemId: row.order_item_id, quantity: row.quantity });
    const recorded = full.returns.reduce((sum, r) => sum + (r.refundDuePaise ?? 0), 0);
    if (recorded + due > payment.amount_paise) {
      throw new ConflictError(
        `Refunds recorded for this order (${recorded} + ${due} paise) would exceed the captured ${payment.amount_paise}.`,
      );
    }
    await tx.returnRequest.update({
      where: { id: row.id },
      data: { refundMode: ReturnRefundMode.manual_due, refundDuePaise: due },
      select: { id: true },
    });
    await auditReturn(tx, {
      actor,
      action: "return.refund_due",
      orderId: order.id,
      returnId: row.id,
      before: { state: row.state },
      after: { refundMode: ReturnRefundMode.manual_due, refundDuePaise: due },
      reason: input.reason,
      requestId,
    });
    console.warn(`[returns] RETURN_REFUND_DUE return=${row.id} order=${order.id} amount=${due}`);
    return { mode: ReturnRefundMode.manual_due, amountPaise: due };
  });
}

/**
 * Records the dashboard refund an operator made for a `manual_due` return
 * and closes it. The id is the operator's statement, not a verified
 * Razorpay read: the payment and order rows are not touched — a partial
 * refund never moves them — and the audit row says who recorded it.
 */
export async function recordManualRefund(
  actor: string,
  returnId: string,
  input: z.infer<typeof recordManualRefundSchema>,
  requestId?: string,
): Promise<{ state: ReturnState }> {
  return runLockingTransaction("returns.record_refund", async (tx) => {
    const { order, row } = await lockOrderAndReturn(tx, returnId);
    requireConfirmation(order.order_number, input.confirmOrderNumber);
    if (row.refund_mode !== ReturnRefundMode.manual_due || row.refund_reference) {
      throw new ConflictError("This return has no refund waiting to be recorded.");
    }
    requireState(row, ReturnState.received);
    const taken = await tx.returnRequest.count({ where: { refundReference: input.refundId } });
    if (taken > 0) throw new ConflictError("That refund id is already recorded against another return.");
    await tx.returnRequest.update({
      where: { id: row.id },
      data: { refundReference: input.refundId, state: ReturnState.completed, completedAt: new Date() },
      select: { id: true },
    });
    await auditReturn(tx, {
      actor,
      action: "return.refund_recorded",
      orderId: order.id,
      returnId: row.id,
      before: { state: row.state },
      after: { state: ReturnState.completed, refundReference: input.refundId, refundDuePaise: row.refund_due_paise },
      requestId,
    });
    return { state: ReturnState.completed };
  });
}

/**
 * Ships an exchange's replacement once the original pair is in and passed
 * (published: "exchanges ship out as soon as we receive your original
 * pair"). Stock for the new size is taken here, under lock, never below
 * what live checkouts hold — so a size that sold out in the meantime is
 * refused, not oversold.
 */
export async function dispatchReplacement(
  actor: string,
  returnId: string,
  input: z.infer<typeof dispatchReplacementSchema>,
  requestId?: string,
): Promise<{ state: ReturnState }> {
  await runLockingTransaction("returns.dispatch", async (tx) => {
    const { order, row } = await lockOrderAndReturn(tx, returnId);
    if (row.kind !== ReturnKind.exchange || !row.requested_variant_id) {
      throw new ConflictError("Only an exchange ships a replacement.");
    }
    requireState(row, ReturnState.received);
    if (row.qc_passed !== true) throw new ConflictError("The original pair did not pass the quality check.");
    if (row.replacement_awb) throw new ConflictError("The replacement has already shipped.");
    const [stock] = await tx.$queryRaw<{ quantity_on_hand: number; quantity_reserved: number }[]>`
      SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE variant_id = ${row.requested_variant_id}::uuid FOR UPDATE
    `;
    if (!stock || stock.quantity_on_hand - stock.quantity_reserved < row.quantity) {
      throw new ConflictError("The replacement size is out of stock. Restock it, or refund the customer instead.");
    }
    await applyStockChange(tx, {
      variantId: row.requested_variant_id,
      delta: -row.quantity,
      reason: `exchange replacement for ${order.order_number}`,
      actor,
      requestId,
      context: { returnId: row.id },
    });
    const now = new Date();
    await tx.returnRequest.update({
      where: { id: row.id },
      data: {
        replacementCourier: input.courier,
        replacementAwb: input.awb,
        replacementDispatchedAt: now,
        state: ReturnState.completed,
        completedAt: now,
      },
      select: { id: true },
    });
    await auditReturn(tx, {
      actor,
      action: "return.replacement_dispatched",
      orderId: order.id,
      returnId: row.id,
      before: { state: row.state },
      after: { state: ReturnState.completed, courier: input.courier, awb: input.awb },
      requestId,
    });
  });
  invalidateCatalogCache();
  return { state: ReturnState.completed };
}

/**
 * A failed delivery is back at the warehouse (task 6): one `rto` row per
 * order item, with its quality check and restock decision, in one
 * transaction. The order must already be `rto` (the courier's report,
 * recorded as a status change). Recording it twice is refused by the
 * one-RTO-row-per-item index. The refund, if any, is the order's ordinary
 * full refund; a re-ship and its charge are not built (the amount is D11).
 */
export async function receiveRto(
  actor: string,
  orderNumberInput: string,
  input: z.infer<typeof rtoReceiveSchema>,
  requestId?: string,
): Promise<{ restockedUnits: number }> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  if (!orderNumber) throw new NotFoundError("Order not found.");
  let restockedUnits = 0;
  try {
    await runLockingTransaction("returns.rto", async (tx) => {
      restockedUnits = 0;
      const ref = await tx.order.findUnique({ where: { orderNumber }, select: { id: true } });
      if (!ref) throw new NotFoundError("Order not found.");
      const order = await lockOrder(tx, ref.id);
      if (order.status !== OrderStatus.rto) {
        throw new ConflictError(`The order is ${order.status}; mark it rto when the courier reports the failed delivery.`);
      }
      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { id: true, sku: true, quantity: true, variantId: true },
      });
      const decisions = new Map(input.items.map((item) => [item.sku.toUpperCase(), item]));
      if (decisions.size !== input.items.length || decisions.size !== items.length || items.some((item) => !decisions.has(item.sku))) {
        throw new ValidationError("Give one decision for every item in the order.");
      }
      for (const item of items) {
        const decision = decisions.get(item.sku);
        if (decision?.restock && !decision.qcPassed) throw new ValidationError("Only items that pass the quality check can be restocked.");
        if (decision?.restock && !item.variantId) throw new ConflictError(`${item.sku} no longer exists; it cannot be restocked.`);
      }
      const now = new Date();
      for (const item of items) {
        const decision = decisions.get(item.sku);
        await tx.returnRequest.create({
          data: {
            orderId: order.id,
            orderItemId: item.id,
            kind: ReturnKind.rto,
            reason: ReturnReason.undelivered,
            state: ReturnState.completed,
            quantity: item.quantity,
            requestedBy: actor,
            qcPassed: decision?.qcPassed ?? false,
            receivedAt: now,
            completedAt: now,
            ...(decision?.restock ? { restockedAt: now } : {}),
          },
          select: { id: true },
        });
      }
      // Stock rows by variant id: the global inventory lock order.
      const restock = items
        .filter((item) => decisions.get(item.sku)?.restock && item.variantId)
        .sort((a, b) => (a.variantId! < b.variantId! ? -1 : 1));
      for (const item of restock) {
        await applyStockChange(tx, {
          variantId: item.variantId!,
          delta: item.quantity,
          reason: `RTO received for ${order.order_number}`,
          actor,
          requestId,
        });
        restockedUnits += item.quantity;
      }
      await writeAudit(tx, {
        actor,
        action: "order.rto_received",
        entity: "order",
        entityId: order.id,
        before: { status: order.status },
        after: { items: input.items.map((item) => ({ sku: item.sku, qcPassed: item.qcPassed, restock: item.restock })) },
        reason: input.note,
        requestId,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("This failed delivery has already been received.");
    throw error;
  }
  if (restockedUnits > 0) invalidateCatalogCache();
  return { restockedUnits };
}

// ---------------------------------------------------------------- admin reads

export interface AdminReturnRow extends CustomerReturnView {
  qcPassed: boolean | null;
  refundReference: string | null;
  refundMode: ReturnRefundMode | null;
}

export async function listOrderReturns(orderId: string): Promise<AdminReturnRow[]> {
  const rows = await prisma.returnRequest.findMany({
    where: { orderId },
    select: RETURN_VIEW_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    ...toCustomerReturnView(row),
    qcPassed: row.qcPassed,
    refundReference: row.refundReference,
    refundMode: row.refundMode,
  }));
}

/** For the Exceptions page: every request an operator still has to move. */
export async function listReturnsNeedingAction() {
  const rows = await prisma.returnRequest.findMany({
    where: { state: { in: [...OPEN_RETURN_STATES] } },
    select: {
      id: true,
      kind: true,
      state: true,
      quantity: true,
      refundMode: true,
      refundDuePaise: true,
      createdAt: true,
      order: { select: { orderNumber: true } },
      orderItem: { select: { sku: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order.orderNumber,
    sku: row.orderItem.sku,
    kind: row.kind,
    state: row.state,
    quantity: row.quantity,
    refundDuePaise: row.refundMode === ReturnRefundMode.manual_due ? row.refundDuePaise : null,
    createdAt: row.createdAt,
  }));
}
