import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { createCheckoutSession } from "@/server/checkout/service";
import { assertCheckoutMutationAllowed } from "@/server/checkout/rate-limit";
import { createCheckoutSessionBodySchema } from "@/server/checkout/schemas";

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCheckoutMutationAllowed(request, session.identity);

    const parsed = createCheckoutSessionBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }

    const checkoutSession = await createCheckoutSession(
      session.identity,
      parsed.data.idempotencyKey,
    );
    return applyCookies(
      NextResponse.json({ checkoutSession }, { status: 201 }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("checkout/session", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
