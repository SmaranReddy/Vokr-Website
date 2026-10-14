import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertReservationAllowed } from "@/server/checkout/rate-limit";
import { reserveCheckoutSession } from "@/server/checkout/reserve";

/**
 * Holds stock for a priced session (plan §5 Phase 8). Takes no body: what
 * is reserved is the session's own pricing snapshot, never client input.
 * Idempotent — repeating the call returns the same reservation.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/checkout/session/[id]/reserve">,
) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    assertOrderingEnabled();

    const { id } = await context.params;
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertReservationAllowed(request, session.identity);

    const checkoutSession = await reserveCheckoutSession(session.identity, id);
    return applyCookies(NextResponse.json({ checkoutSession }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("checkout/session/[id]/reserve", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
