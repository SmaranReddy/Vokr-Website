import type { NextRequest } from "next/server";

import type { Identity } from "@/server/auth/session";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";

/** Same two-bucket pattern as `server/checkout/rate-limit.ts`. Order creation is idempotent, so a legitimate customer needs only a handful. */
export async function assertPaymentOrderAllowed(
  request: NextRequest,
  identity: Identity,
): Promise<void> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `payments:order:ip:${ip}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });

  const identityKey =
    identity.type === "user" ? `user:${identity.userId}` : `guest:${identity.guestSessionId}`;
  await assertWithinRateLimit({
    key: `payments:order:identity:${identityKey}`,
    limit: 10,
    windowMs: 5 * 60 * 1000,
  });
}

/**
 * Per-IP ceiling on the webhook endpoint (Security Requirements: "rate
 * limited and IP-observed, but never IP-allowlisted as the only
 * control"). The signature is the real control; this only bounds how much
 * unsigned noise one address can make the app hash. Set well above
 * Razorpay's own retry bursts.
 */
export async function assertWebhookAllowed(request: NextRequest): Promise<string> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `webhooks:razorpay:ip:${ip}`,
    limit: 600,
    windowMs: 5 * 60 * 1000,
  });
  return ip;
}
