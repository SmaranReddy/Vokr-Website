import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { clearCart, getCart } from "@/server/cart";
import { assertCartMutationAllowed } from "@/server/cart/rate-limit";

/** Guest cookie minting on first visit still needs its `Set-Cookie` applied, even on a read. */
export async function GET(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    const cart = await getCart(session.identity);
    return applyCookies(NextResponse.json({ cart }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("cart", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}

export async function DELETE(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCartMutationAllowed(request, session.identity);

    const cart = await clearCart(session.identity);
    return applyCookies(NextResponse.json({ cart }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("cart", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
