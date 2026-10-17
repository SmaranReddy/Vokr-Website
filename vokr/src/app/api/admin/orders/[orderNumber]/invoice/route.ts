import type { NextRequest } from "next/server";

import { handleAdmin } from "@/server/admin/route";
import { documentKind, loadInvoice, renderInvoiceHtml } from "@/server/invoices/render";

/** `GET /api/admin/orders/[orderNumber]/invoice` — the order's tax invoice as printable HTML (plan §5 Phase 9, task 8). 404 until issued. */
export async function GET(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/invoice">) {
  return handleAdmin(request, "orders/invoice", async () => {
    const { orderNumber } = await context.params;
    const html = renderInvoiceHtml(await loadInvoice(orderNumber, {}, documentKind(request)));
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
    });
  });
}
