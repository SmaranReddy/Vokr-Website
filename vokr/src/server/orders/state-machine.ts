import { OrderStatus } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

/**
 * `confirmed → preparing → shipped → delivered`, plus `cancelled`,
 * `returned`, `refunded` and `rto` (plan §5 Phase 9, task 5) — the four
 * steps the legacy order tracker draws, and the ways an order leaves them.
 *
 * - `refunded` is terminal and reachable from anywhere money can still be
 *   returned; a full refund of the order's own payment lands here.
 * - `cancelled` is only possible before shipping; after that the way back
 *   is `rto` (returned to origin) or a customer `return`.
 * - Nothing moves backwards.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.confirmed]: [OrderStatus.preparing, OrderStatus.cancelled, OrderStatus.refunded],
  [OrderStatus.preparing]: [OrderStatus.shipped, OrderStatus.cancelled, OrderStatus.refunded],
  [OrderStatus.shipped]: [OrderStatus.delivered, OrderStatus.rto, OrderStatus.refunded],
  [OrderStatus.delivered]: [OrderStatus.returned, OrderStatus.refunded],
  [OrderStatus.returned]: [OrderStatus.refunded],
  [OrderStatus.rto]: [OrderStatus.refunded],
  [OrderStatus.cancelled]: [OrderStatus.refunded],
  [OrderStatus.refunded]: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertValidOrderTransition(orderId: string, from: OrderStatus, to: OrderStatus): void {
  if (isValidOrderTransition(from, to)) return;
  console.warn(`[orders] order=${orderId} REJECTED illegal transition ${from} -> ${to}`);
  throw new ConflictError(`Order cannot move from "${from}" to "${to}".`);
}

/** The steps of the customer-facing tracker, in order; other statuses are shown on their own. */
export const TRACKER_STEPS: readonly OrderStatus[] = [
  OrderStatus.confirmed,
  OrderStatus.preparing,
  OrderStatus.shipped,
  OrderStatus.delivered,
];
