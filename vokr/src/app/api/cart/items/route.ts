import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { addItem } from "@/server/cart";
import { assertCartMutationAllowed } from "@/server/cart/rate-limit";
import { addItemBodySchema } from "@/server/cart/schemas";

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCartMutationAllowed(request, session.identity);

    const parsed = addItemBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }

    const cart = await addItem(session.identity, parsed.data);
    return applyCookies(NextResponse.json({ cart }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("cart/items", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
