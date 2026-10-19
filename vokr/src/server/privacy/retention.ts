import { prisma } from "@/server/db/client";

/**
 * Retention for the §3.5 rows `pruneExpiredRows()` does not enforce yet
 * (plan §5 Phase 17, task 8). **Report-only by default:** each run counts
 * what is past its rule, and the maintenance log carries the counts, so
 * the owner can see the backlog before anything is removed.
 *
 * - Guest sessions: 90 days after `last_seen_at` (§3.5).
 * - Abandoned carts: open, 30 days after `updated_at` (§3.5).
 * - Checkout contact emails: on sessions that never became an order, 30
 *   days after their last change — the life of the abandoned cart they
 *   were opened from (§3.5 says only "with the session").
 * - Audit log older than a year, and consent records of accounts erased
 *   more than a year ago: §3.5 has no rule for the first and "life of the
 *   account + 1 year" for the second; counted for legal review.
 *
 * Purging is behind {@link RETENTION_PURGE_ENABLED} and implemented only
 * where it cannot break a constraint: clearing the contact email of a
 * checkout that never became an order. Guest sessions and carts are
 * referenced by `checkout_sessions` (one-identity CHECK), so deleting them
 * needs a checkout-session retention decision first (see `prune.ts`).
 */

/** Off until the owner has read a few weeks of counts and legal review agrees the rules. A reviewed code change, never config. */
export const RETENTION_PURGE_ENABLED: boolean = false;

export interface RetentionReport {
  mode: "report" | "purge";
  guestSessionsPastRetention: number;
  abandonedCartsPastRetention: number;
  checkoutContactEmailsPastRetention: number;
  auditLogOlderThanOneYear: number;
  consentRecordsPastRetention: number;
  /** Rows changed by the purge; always 0 in report mode. */
  checkoutContactEmailsCleared: number;
}

const count = (rows: { n: bigint }[]) => Number(rows[0]?.n ?? 0);

export async function applyRetention(options: { purge?: boolean } = {}): Promise<RetentionReport> {
  const purge = options.purge ?? RETENTION_PURGE_ENABLED;
  const [guests, carts, emails, audit, consents] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM guest_sessions WHERE last_seen_at < now() - interval '90 days'`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM carts WHERE status = 'open' AND updated_at < now() - interval '30 days'`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM checkout_sessions s
       WHERE s.contact_email_enc IS NOT NULL AND s.updated_at < now() - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.checkout_session_id = s.id)
         AND s.state NOT IN ('reserved', 'payment_pending', 'paid')`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM audit_log WHERE created_at < now() - interval '1 year'`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM consent_records c JOIN app_users u ON u.id = c.user_id
       WHERE u.deleted_at < now() - interval '1 year'`,
  ]);
  let cleared = 0;
  if (purge) {
    cleared = await prisma.$executeRaw`
      UPDATE checkout_sessions s SET contact_email_enc = NULL
       WHERE s.contact_email_enc IS NOT NULL AND s.updated_at < now() - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.checkout_session_id = s.id)
         AND s.state NOT IN ('reserved', 'payment_pending', 'paid')`;
  }
  return {
    mode: purge ? "purge" : "report",
    guestSessionsPastRetention: count(guests),
    abandonedCartsPastRetention: count(carts),
    checkoutContactEmailsPastRetention: count(emails),
    auditLogOlderThanOneYear: count(audit),
    consentRecordsPastRetention: count(consents),
    checkoutContactEmailsCleared: cleared,
  };
}
