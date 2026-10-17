import { prisma } from "@/server/db/client";

/**
 * Row pruning (plan §3.5 retention table), limited to tables nothing else
 * references, so a delete can never cascade into, or be blocked by,
 * customer data:
 *
 * - `rate_limit_counters` older than 24 hours;
 * - `webhook_events` older than 90 days, except those that failed to
 *   apply (`processing_error` set): one of those may be the only record of
 *   money on an order this server does not know (`UNMATCHED_PAYMENT`), so
 *   it is kept until a person deals with it;
 * - `inventory_reservations` that were released or expired more than
 *   7 days ago. Committed holds are kept: they are the stock half of a
 *   paid checkout;
 * - `email_log` rows that finished (`sent` or `failed`) more than 180 days
 *   ago (plan §5 Phase 11, Database Impact). `pending`/`sending` rows are
 *   work in flight and are never pruned. No row is ever re-created by
 *   this: emails are enqueued only on a one-time order event (creation,
 *   the first `shipped` transition).
 *
 * Abandoned carts (30 days) and guest sessions (90 days) are **not** pruned
 * here yet: `checkout_sessions` references both, and its
 * `ON DELETE SET NULL` foreign keys would violate the session's
 * one-identity CHECK. That needs its own retention decision for checkout
 * sessions first.
 */
export interface PruneReport {
  rateLimitCounters: number;
  webhookEvents: number;
  reservations: number;
  emailLog: number;
}

export const EMAIL_LOG_RETENTION_DAYS = 180;

export async function pruneExpiredRows(): Promise<PruneReport> {
  const rateLimitCounters = await prisma.$executeRaw`
    DELETE FROM rate_limit_counters WHERE window_start < now() - interval '24 hours'
  `;
  const webhookEvents = await prisma.$executeRaw`
    DELETE FROM webhook_events
     WHERE received_at < now() - interval '90 days' AND processing_error IS NULL
  `;
  const reservations = await prisma.$executeRaw`
    DELETE FROM inventory_reservations
     WHERE state IN ('released', 'expired') AND updated_at < now() - interval '7 days'
  `;
  const emailLog = await prisma.$executeRaw`
    DELETE FROM email_log
     WHERE status IN ('sent', 'failed')
       AND COALESCE(sent_at, updated_at) < now() - make_interval(days => ${EMAIL_LOG_RETENTION_DAYS}::int)
  `;
  return { rateLimitCounters, webhookEvents, reservations, emailLog };
}
