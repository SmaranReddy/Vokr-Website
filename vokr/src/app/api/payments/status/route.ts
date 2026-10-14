import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getPaymentStatus } from "@/server/payments/service";

const querySchema = z.object({ checkoutSessionId: z.uuid() }).strict();

/**
 * What the browser polls after Razorpay Checkout closes. Read-only: the
 * Checkout success handler's payment ID and signature are never accepted
 * here or anywhere else — verified webhooks are the only writer of payment
 * state (plan §5 Phase 7, task 5).
 */
export async function GET(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    assertOrderingEnabled();

    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      throw new ValidationError("Invalid query parameters.");
    }

    const payment = await getPaymentStatus(session.identity, parsed.data.checkoutSessionId);
    return applyCookies(NextResponse.json({ payment }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("payments/status", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
