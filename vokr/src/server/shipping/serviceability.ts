import type { NextRequest } from "next/server";

import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";
import { prisma } from "@/server/db/client";

export type ServiceabilityResult =
  | { serviceable: true; codEligible: boolean; estimatedDeliveryDays: number }
  | { serviceable: false };

/**
 * Looks up `serviceable_pincodes`, seeded manually from a Shiprocket
 * export (plan §5 Phase 6, task 3 — the API integration is deferred). A
 * pincode absent from the table is **not serviceable** — this fails
 * closed rather than promising delivery Vokr cannot make.
 */
export async function getServiceability(
  pincode: string,
): Promise<ServiceabilityResult> {
  const row = await prisma.serviceablePincode.findUnique({
    where: { pincode },
    select: { codEligible: true, estimatedDeliveryDays: true },
  });

  if (!row) {
    return { serviceable: false };
  }

  return {
    serviceable: true,
    codEligible: row.codEligible,
    estimatedDeliveryDays: row.estimatedDeliveryDays,
  };
}

/**
 * The serviceability endpoint is unauthenticated by design (a customer
 * checks a PIN before signing in) and therefore a scraping/enumeration
 * target (plan §5 Phase 6, Security Requirements) — rate limited by IP
 * only, the same pattern as every other unauthenticated lookup in this
 * codebase.
 */
export async function assertServiceabilityLookupAllowed(
  request: NextRequest,
): Promise<void> {
  const ip = getClientIp(request);
  await assertWithinRateLimit({
    key: `shipping:serviceability:ip:${ip}`,
    limit: 30,
    windowMs: 5 * 60 * 1000,
  });
}
