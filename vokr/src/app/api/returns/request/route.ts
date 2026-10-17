import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getClientIp } from "@/server/net/client-ip";
import { requestIdOf } from "@/server/net/request-id";
import { requestReturnAsGuest } from "@/server/returns/service";

/**
 * `POST /api/returns/request` — a return or exchange request by order
 * number + email, no login (plan §5 Phase 10, task 7). The guest order
 * lookup's limits, uniform 404/429 and timing floor apply before anything
 * about the order is checked. Behind the ordering gate, like the lookup.
 */
export async function POST(request: NextRequest) {
  try {
    assertOrderingEnabled();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Check the return details.");
    }
    const created = await requestReturnAsGuest({ ip: getClientIp(request), body });
    return NextResponse.json({ return: created }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("returns/request", requestId, error);
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }
}
