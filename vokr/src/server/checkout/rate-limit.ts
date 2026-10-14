import type { NextRequest } from "next/server";

import type { Identity } from "@/server/auth/session";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";

/** Same two-bucket pattern as `server/cart/rate-limit.ts` — per-IP and per-identity. */
export async function assertCheckoutMutationAllowed(
  request: NextRequest,
  identity: Identity,
): Promise<void> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `checkout:mutate:ip:${ip}`,
    limit: 60,
    windowMs: 5 * 60 * 1000,
  });

  const identityKey =
    identity.type === "user"
      ? `user:${identity.userId}`
      : `guest:${identity.guestSessionId}`;
  await assertWithinRateLimit({
    key: `checkout:mutate:identity:${identityKey}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
}

/**
 * Reservation attempts (Phase 8 Security Requirements). Tighter than the
 * general checkout buckets: a reserve call holds real stock for 15
 * minutes, and repeating it is how an actor would try to keep stock away
 * from everyone else. A duplicate call is idempotent, so a legitimate
 * customer needs very few.
 */
export async function assertReservationAllowed(
  request: NextRequest,
  identity: Identity,
): Promise<void> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `checkout:reserve:ip:${ip}`,
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });

  const identityKey =
    identity.type === "user"
      ? `user:${identity.userId}`
      : `guest:${identity.guestSessionId}`;
  await assertWithinRateLimit({
    key: `checkout:reserve:identity:${identityKey}`,
    limit: 10,
    windowMs: 5 * 60 * 1000,
  });
}
