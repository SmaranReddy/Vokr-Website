import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getClientIp } from "@/server/net/client-ip";
import { requestIdOf } from "@/server/net/request-id";
import { listReturnsAsGuest } from "@/server/returns/service";

/**
 * `POST /api/returns/lookup` — the status of an order's returns and
 * exchanges, by order number + email (plan §5 Phase 10, task 7). POST, not
 * `GET /api/returns/[id]`: the email is the credential and never belongs in
 * a URL. Same protections as the order lookup.
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
    const returns = await listReturnsAsGuest({ ip: getClientIp(request), body });
    return NextResponse.json({ returns }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("returns/lookup", requestId, error);
    return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
  }
}
