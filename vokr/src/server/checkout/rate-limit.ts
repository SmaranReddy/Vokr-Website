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
