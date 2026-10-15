import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getClientIp } from "@/server/net/client-ip";
import { lookupGuestOrder } from "@/server/orders/lookup";

/**
 * `POST /api/orders/lookup` — guest order lookup by order number + email
 * (plan §5 Phase 9, task 6). Unauthenticated by design; every protection
 * (limits, uniform errors, uniform timing, constant-time email check)
 * lives in `lookupGuestOrder`. Behind the ordering gate while the
 * storefront is browse-only (§2A.6 row L1): with no orders there is
 * nothing to look up, and nothing reachable should only ever fail. When
 * ordering opens, keeping lookup available if it is paused again needs its
 * own switch (launch checklist).
 */
export async function POST(request: NextRequest) {
  try {
    assertOrderingEnabled();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Enter your order number and email.");
    }
    const order = await lookupGuestOrder({ ip: getClientIp(request), body });
    return NextResponse.json({ order }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("orders/lookup", requestId, error);
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }
}
