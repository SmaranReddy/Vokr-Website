import { invalidateCatalogCache } from "@/server/catalog";
import type { RazorpayClient } from "@/server/payments/razorpay";
import { reconcilePendingPayments } from "@/server/payments/reconcile";

import { expireReservations, type ExpiryReport } from "./expire-reservations";
import { pruneExpiredRows, type PruneReport } from "./prune";

type Step<T> = { status: "ok"; result: T } | { status: "error" } | { status: "not_configured" };

export interface MaintenanceReport {
  ok: boolean;
  reconciliation: Step<{ checked: number; applied: number; ignored: number; rejected: number }>;
  expiry: Step<ExpiryReport>;
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
 * before expiry looks at it. Every step is idempotent — a repeated or
 * overlapping run finds nothing left to change — and one failing step does
 * not stop the others. Without Razorpay credentials, reconciliation is
 * reported `not_configured` and expiry keeps any hold that has a Razorpay
 * order, because it cannot prove no money moved. The report carries counts
 * only: no identifiers, no customer data.
 */
export async function runMaintenance(razorpay: RazorpayClient | null): Promise<MaintenanceReport> {
  const reconciliation: MaintenanceReport["reconciliation"] = razorpay
    ? await step("reconciliation", async () => {
        const { checked, outcomes } = await reconcilePendingPayments(razorpay);
        return {
          checked,
          applied: outcomes.filter((outcome) => outcome.kind === "applied").length,
          ignored: outcomes.filter((outcome) => outcome.kind === "ignored").length,
          rejected: outcomes.filter((outcome) => outcome.kind === "rejected").length,
        };
      })
    : { status: "not_configured" };

  const expiry = await step("expiry", () => expireReservations(razorpay));
  if (expiry.status === "ok" && expiry.result.outcomes.expired > 0) invalidateCatalogCache();
  if (reconciliation.status === "ok" && reconciliation.result.applied > 0) invalidateCatalogCache();

  const pruning = await step("pruning", pruneExpiredRows);

  const ok =
    reconciliation.status !== "error" &&
    expiry.status === "ok" &&
    expiry.result.errors === 0 &&
    pruning.status === "ok";
  console.info(`[jobs/maintenance] finished ok=${ok} ${JSON.stringify({ reconciliation, expiry, pruning })}`);
  return { ok, reconciliation, expiry, pruning };
}
