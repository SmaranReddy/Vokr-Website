import { invalidateCatalogCache } from "@/server/catalog";
import type { TransactionalEmailClient } from "@/server/email/brevo";
import { sendPendingEmails, type EmailOutboxReport } from "@/server/email/outbox";
import { findOrderOrphans, type OrderReconciliationReport } from "@/server/orders/reconcile";
import { resolvePaymentIssues, type PaymentIssueReport } from "@/server/payments/late-payment";
import type { RazorpayClient, RazorpayRefundClient } from "@/server/payments/razorpay";
import { reconcileClosedOrders, reconcilePendingPayments } from "@/server/payments/reconcile";

import { expireReservations, type ExpiryReport } from "./expire-reservations";
import { pruneExpiredRows, type PruneReport } from "./prune";

type Step<T> = { status: "ok"; result: T } | { status: "error" } | { status: "not_configured" };

export interface MaintenanceReport {
  ok: boolean;
  reconciliation: Step<{
    checked: number;
    applied: number;
    ignored: number;
    rejected: number;
    /** Closed orders re-read for a payment whose webhook never came. */
    closedOrdersChecked: number;
    /** Observations that need a refund or a person (late, extra or mismatched money). */
    warnings: number;
    /** Orders that could not be read or applied; the rest of the batch still ran. */
    errors: number;
  }>;
  expiry: Step<ExpiryReport>;
  latePayments: Step<PaymentIssueReport>;
  /** Orders against payments (plan §5 Phase 9, task 9). Reported, never failing the run. */
  orders: Step<OrderReconciliationReport>;
  /** The email outbox (plan §5 Phase 11). `not_configured` without a Brevo key; pending rows wait. */
  emails: Step<EmailOutboxReport>;
  pruning: Step<PruneReport>;
}

async function step<T>(name: string, run: () => Promise<T>): Promise<Step<T>> {
  try {
    return { status: "ok", result: await run() };
  } catch (error) {
    console.error(`[jobs/maintenance] step ${name} failed`, error);
    return { status: "error" };
  }
}

/**
 * Cloud Scheduler job 3 (plan §5 Phase 8, task 7): reconcile payments
 * whose webhook never came, release expired stock holds, prune old rows.
 *
 * Reconciliation runs first so that a capture it finds commits its hold
 * before expiry looks at it. Late payments (money for a session that no
 * longer holds stock) are refunded after both, so a capture either of
 * them just recorded is handled in the same run. Every step is idempotent — a repeated or
 * overlapping run finds nothing left to change — and one failing step does
 * not stop the others. Without Razorpay credentials, reconciliation is
 * reported `not_configured` and expiry keeps any hold that has a Razorpay
 * order, because it cannot prove no money moved. The report carries counts
 * only: no identifiers, no customer data.
 */
export async function runMaintenance(
  razorpay: RazorpayClient | null,
  refunds: RazorpayRefundClient | null = null,
  email: TransactionalEmailClient | null = null,
): Promise<MaintenanceReport> {
  const reconciliation: MaintenanceReport["reconciliation"] = razorpay
    ? await step("reconciliation", async () => {
        const pending = await reconcilePendingPayments(razorpay);
        const closed = await reconcileClosedOrders(razorpay);
        const outcomes = [...pending.outcomes, ...closed.outcomes];
        return {
          checked: pending.checked,
          closedOrdersChecked: closed.checked,
          warnings: outcomes.filter((outcome) => outcome.warning).length,
          errors: pending.errors + closed.errors,
          applied: outcomes.filter((outcome) => outcome.kind === "applied").length,
          ignored: outcomes.filter((outcome) => outcome.kind === "ignored").length,
          rejected: outcomes.filter((outcome) => outcome.kind === "rejected").length,
        };
      })
    : { status: "not_configured" };

  const expiry = await step("expiry", () => expireReservations(razorpay));
  if (expiry.status === "ok" && expiry.result.outcomes.expired > 0) invalidateCatalogCache();
  if (reconciliation.status === "ok" && reconciliation.result.applied > 0) invalidateCatalogCache();

  // Open issues stay open, durably, until Razorpay can be read: without
  // credentials nothing is refunded and nothing is closed.
  const latePayments: MaintenanceReport["latePayments"] = refunds
    ? await step("latePayments", () => resolvePaymentIssues(refunds))
    : { status: "not_configured" };

  const orders = await step("orders", findOrderOrphans);

  // After everything that can create an order, so a confirmation is sent in the same run.
  const emails: MaintenanceReport["emails"] = email
    ? await step("emails", () => sendPendingEmails(email))
    : { status: "not_configured" };

  const pruning = await step("pruning", pruneExpiredRows);

  const ok =
    reconciliation.status !== "error" &&
    (reconciliation.status !== "ok" || reconciliation.result.errors === 0) &&
    expiry.status === "ok" &&
    expiry.result.errors === 0 &&
    latePayments.status !== "error" &&
    (latePayments.status !== "ok" || latePayments.result.errors === 0) &&
    orders.status === "ok" &&
    emails.status !== "error" &&
    pruning.status === "ok";
  console.info(`[jobs/maintenance] finished ok=${ok} ${JSON.stringify({ reconciliation, expiry, latePayments, orders, emails, pruning })}`);
  return { ok, reconciliation, expiry, latePayments, orders, emails, pruning };
}
