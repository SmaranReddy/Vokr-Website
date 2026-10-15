import { prisma } from "@/server/db/client";

export const ORDER_ORPHAN_TAG = "ORDER_ORPHAN";

export interface OrderReconciliationReport {
  /** Sessions marked `paid` with no order. */
  paidSessionsWithoutOrder: number;
  /**
   * Payments Razorpay captured (or that were captured, then refunded) that
   * have neither an order nor a `payment_issues` row — money nobody is
   * fulfilling or refunding. Late and extra payments have an issue
   * instead of an order, by design, and are not orphans.
   */
  capturedPaymentsUnaccounted: number;
  /** Prepaid orders whose payment is not `captured` or `refunded`. */
  ordersWithoutCapture: number;
}

/**
 * Plan §5 Phase 9, task 9: an order for every captured payment, and a
 * captured payment for every prepaid order. Counts only — no identifiers,
 * no customer data. Any orphan is logged at error level under
 * {@link ORDER_ORPHAN_TAG} for alerting (Phase 15); the maintenance run
 * itself does not fail on it, so one stuck record cannot hide every later
 * failure behind a permanently red job.
 */
export async function findOrderOrphans(): Promise<OrderReconciliationReport> {
  const [row] = await prisma.$queryRaw<
    { paid_without_order: bigint; captured_unaccounted: bigint; orders_without_capture: bigint }[]
  >`
    SELECT
      (SELECT count(*) FROM checkout_sessions s
        WHERE s.state = 'paid'
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.checkout_session_id = s.id)) AS paid_without_order,
      (SELECT count(*) FROM payments p
        WHERE p.status IN ('captured', 'refunded')
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.payment_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM payment_issues i WHERE i.payment_id = p.id)) AS captured_unaccounted,
      (SELECT count(*) FROM orders o
        LEFT JOIN payments p ON p.id = o.payment_id
        WHERE o.payment_method = 'prepaid'
          AND (p.id IS NULL OR p.status NOT IN ('captured', 'refunded'))) AS orders_without_capture
  `;
  const report: OrderReconciliationReport = {
    paidSessionsWithoutOrder: Number(row?.paid_without_order ?? 0),
    capturedPaymentsUnaccounted: Number(row?.captured_unaccounted ?? 0),
    ordersWithoutCapture: Number(row?.orders_without_capture ?? 0),
  };
  if (Object.values(report).some((count) => count > 0)) {
    console.error(`[orders] ${ORDER_ORPHAN_TAG} ${JSON.stringify(report)}`);
  }
  return report;
}
