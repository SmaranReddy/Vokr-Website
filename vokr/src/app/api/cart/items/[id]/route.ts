import { NextResponse, type NextRequest } from "next/server";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { removeItem, updateQuantity } from "@/server/cart";
import { assertCartMutationAllowed } from "@/server/cart/rate-limit";
import { updateQuantityBodySchema } from "@/server/cart/schemas";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/cart/items/[id]">,
) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const { id } = await context.params;
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCartMutationAllowed(request, session.identity);

    const parsed = updateQuantityBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }

    const cart = await updateQuantity(session.identity, id, parsed.data.quantity);
    return applyCookies(NextResponse.json({ cart }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("cart/items/[id]", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/cart/items/[id]">,
) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const { id } = await context.params;
    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertCartMutationAllowed(request, session.identity);

    const cart = await removeItem(session.identity, id);
    return applyCookies(NextResponse.json({ cart }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("cart/items/[id]", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
