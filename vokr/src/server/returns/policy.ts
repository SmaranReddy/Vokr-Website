import { ReturnKind, ReturnState } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

/**
 * The returns rules that are already published, and nothing more
 * (`terms` §7–8, `/support-exchange-returns`): 30 days from delivery,
 * exchange or return, refunds to the original payment method after the
 * item passes a quality check, exchanges ship once the original pair is
 * received. Everything the copy does not settle — return labels, re-ship
 * charges, COD refunds, whether shipping is refunded — is refused or left to
 * an operator, never decided here.
 */

export const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A customer request that still occupies its order item. */
export const OPEN_RETURN_STATES: readonly ReturnState[] = [
  ReturnState.requested,
  ReturnState.approved,
  ReturnState.received,
];

export function returnWindowClosesAt(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
}

/** Refuses a request outside the window. `deliveredAt` is the order's `→ delivered` history row. */
export function assertWithinReturnWindow(deliveredAt: Date | null, now: Date): void {
  if (!deliveredAt) throw new ConflictError("Returns and exchanges open once an order is delivered.");
  const closesAt = returnWindowClosesAt(deliveredAt);
  if (now.getTime() > closesAt.getTime()) {
    throw new ConflictError(
      `The ${RETURN_WINDOW_DAYS}-day return window for this order closed on ${closesAt.toISOString().slice(0, 10)}.`,
    );
  }
}

/** Units of an item already claimed by returns and exchanges (anything not rejected; RTO rows are not claims). */
export function claimedUnits(rows: readonly { kind: ReturnKind; state: ReturnState; quantity: number }[]): number {
  return rows
    .filter((row) => row.kind !== ReturnKind.rto && row.state !== ReturnState.rejected)
    .reduce((total, row) => total + row.quantity, 0);
}

/**
 * What a returned quantity of a line is worth. `unit_price_paise` is
 * GST-inclusive and a line's subtotal is exactly `unit × quantity`, so this
 * is exact: no rounding, and the lines of an order sum to its subtotal.
 */
export function lineRefundPaise(item: { unitPricePaise: number }, quantity: number): number {
  return item.unitPricePaise * quantity;
}

interface CoverageRow {
  orderItemId: string;
  kind: ReturnKind;
  state: ReturnState;
  quantity: number;
  qcPassed: boolean | null;
  refundMode: string | null;
}

/**
 * The returns that settle the whole order in one full refund, or `null`.
 * Only when every unit of every line is back with a passed quality check,
 * none of them already has a refund recorded, and the order charged nothing
 * but goods: whether shipping or a COD fee is refunded on a return is not
 * a published policy, so such an order is refunded line by line instead.
 */
export function wholeOrderReturn<T extends CoverageRow>(
  order: { shippingPaise: number; codFeePaise: number; items: readonly { id: string; quantity: number }[] },
  rows: readonly T[],
): T[] | null {
  if (order.shippingPaise !== 0 || order.codFeePaise !== 0) return null;
  const settling = rows.filter(
    (row) =>
      row.kind === ReturnKind.return &&
      row.state === ReturnState.received &&
      row.qcPassed === true &&
      row.refundMode === null,
  );
  if (rows.some((row) => row.refundMode !== null)) return null;
  for (const item of order.items) {
    const back = settling.filter((row) => row.orderItemId === item.id).reduce((total, row) => total + row.quantity, 0);
    if (back !== item.quantity) return null;
  }
  return settling;
}
