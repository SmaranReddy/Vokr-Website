import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { requireUser } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { getUserOrder } from "@/server/orders/history";
import { requestIdOf } from "@/server/net/request-id";

/** `GET /api/orders/[orderNumber]` — one of the signed-in customer's orders; anyone else's is a 404 (plan §5 Phase 9, task 7). */
export async function GET(request: NextRequest, context: RouteContext<"/api/orders/[orderNumber]">) {
  let cookiesToSet: CookieWrite[] = [];
  try {
    assertOrderingEnabled();
    const user = await requireUser(request);
    cookiesToSet = user.cookiesToSet;
    const { orderNumber } = await context.params;
    const order = await getUserOrder(user.userId, orderNumber);
    return applyCookies(NextResponse.json({ order }, { headers: { "cache-control": "no-store" } }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("orders/[orderNumber]", requestId, error);
    return applyCookies(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), cookiesToSet);
  }
}
