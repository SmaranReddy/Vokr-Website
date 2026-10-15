import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { requireUser } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { listUserOrders } from "@/server/orders/history";

/** `GET /api/orders` — the signed-in customer's orders, newest first (plan §5 Phase 9, task 7). `?before=VK-…` pages back. */
export async function GET(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];
  try {
    assertOrderingEnabled();
    const user = await requireUser(request);
    cookiesToSet = user.cookiesToSet;
    const before = request.nextUrl.searchParams.get("before") ?? undefined;
    const page = await listUserOrders(user.userId, { before });
    return applyCookies(NextResponse.json(page, { headers: { "cache-control": "no-store" } }), cookiesToSet);
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("orders", requestId, error);
    return applyCookies(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), cookiesToSet);
  }
}
