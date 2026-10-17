import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { requireUser } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { loadInvoice, renderInvoiceHtml } from "@/server/invoices/render";
import { requestIdOf } from "@/server/net/request-id";

/**
 * `GET /api/orders/[orderNumber]/invoice` — the signed-in customer's own tax
 * invoice as printable HTML (plan §5 Phase 9, task 8). Another customer's
 * order, an unknown one and one not yet invoiced are the same 404.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/orders/[orderNumber]/invoice">) {
  let cookiesToSet: CookieWrite[] = [];
  try {
    assertOrderingEnabled();
    const user = await requireUser(request);
    cookiesToSet = user.cookiesToSet;
    const { orderNumber } = await context.params;
    const html = renderInvoiceHtml(await loadInvoice(orderNumber, { ownerUserId: user.userId }));
    return applyCookies(
      new NextResponse(html, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
      }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("orders/[orderNumber]/invoice", requestId, error);
    return applyCookies(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), cookiesToSet);
  }
}
