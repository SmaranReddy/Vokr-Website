import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertCheckoutMutationAllowed } from "@/server/checkout/rate-limit";
import { addressBodySchema } from "@/server/checkout/schemas";
import { setCheckoutAddress } from "@/server/checkout/service";
import { requestIdOf } from "@/server/net/request-id";

export async function PUT(
  request: NextRequest,
  context: RouteContext<"/api/checkout/session/[id]/address">,
) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    assertOrderingEnabled();

    const { id } = await context.params;
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCheckoutMutationAllowed(request, session.identity);

    const parsed = addressBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }

    const checkoutSession = await setCheckoutAddress(
      session.identity,
      id,
      parsed.data,
    );
    return applyCookies(NextResponse.json({ checkoutSession }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("checkout/session/[id]/address", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
