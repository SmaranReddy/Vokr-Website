import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getClientIp } from "@/server/net/client-ip";
import { lookupGuestOrder } from "@/server/orders/lookup";

/**
 * `POST /api/orders/lookup` — guest order lookup by order number + email
 * (plan §5 Phase 9, task 6). Unauthenticated by design; every protection
 * (limits, uniform errors, uniform timing, constant-time email check)
 * lives in `lookupGuestOrder`. Deliberately not behind the ordering gate:
 * an order placed while ordering was open stays trackable if it closes.
 */
export async function POST(request: NextRequest) {
  try {
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
