import type { NextRequest } from "next/server";

import type { Identity } from "@/server/auth/session";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";

/**
 * Two independent buckets, same reasoning as the auth routes
 * (`src/app/api/auth/signin/route.ts`): per-IP stops one attacker
 * hammering many carts, per-identity stops abuse of one cart from
 * rotating IPs. Applied to every cart *mutation* route (plan §5 Phase 5,
 * security requirements) — not to the read-only `GET`.
 */
export async function assertCartMutationAllowed(
  request: NextRequest,
  identity: Identity,
): Promise<void> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `cart:mutate:ip:${ip}`,
    limit: 120,
    windowMs: 5 * 60 * 1000,
  });

  const identityKey =
    identity.type === "user"
      ? `user:${identity.userId}`
      : `guest:${identity.guestSessionId}`;
  await assertWithinRateLimit({
    key: `cart:mutate:identity:${identityKey}`,
    limit: 60,
    windowMs: 5 * 60 * 1000,
  });
}
