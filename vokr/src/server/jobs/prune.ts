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
 *   paid checkout.
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
}

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
  return { rateLimitCounters, webhookEvents, reservations };
}
