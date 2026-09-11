import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertCheckoutMutationAllowed } from "@/server/checkout/rate-limit";
import { pricingQuerySchema } from "@/server/checkout/schemas";
import { priceCheckoutSession } from "@/server/checkout/service";

/**
 * A `GET` with a side effect: computing pricing is also the act of
 * persisting the snapshot (plan §5 Phase 6, task 7) — there is no
 * separate write endpoint in the plan's API surface. Safe to call
 * repeatedly; each call re-derives the snapshot rather than trusting the
 * previous one, so it is rate limited like any other checkout mutation.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/checkout/session/[id]/pricing">,
) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const { id } = await context.params;
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCheckoutMutationAllowed(request, session.identity);

    const parsed = pricingQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      throw new ValidationError("Invalid query parameters.");
    }

    const checkoutSession = await priceCheckoutSession(
      session.identity,
      id,
      parsed.data.paymentMethod,
    );
    return applyCookies(NextResponse.json({ checkoutSession }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("checkout/session/[id]/pricing", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
