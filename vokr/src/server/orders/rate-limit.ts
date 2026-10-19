import { assertWithinRateLimit } from "@/server/rate-limit";

/**
 * Signed-in order history reads (`GET /api/orders`, `/api/orders/[n]`),
 * plan §5 Phase 16 task 6 (every endpoint that touches the database is
 * limited). Per user, after sign-in is proved: generous for a person
 * paging their own orders, tight for a script walking them.
 */
export const ORDER_READ_LIMIT = { limit: 120, windowMs: 5 * 60 * 1000 };

export async function assertOrderReadAllowed(userId: string): Promise<void> {
  await assertWithinRateLimit({ key: `orders:read:user:${userId}`, ...ORDER_READ_LIMIT });
}
