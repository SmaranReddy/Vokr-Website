import type { NextRequest } from "next/server";

import { handleAdmin, parseJsonBody } from "@/server/admin/route";
import { adminReturnRequestSchema, createReturnAsAdmin } from "@/server/returns/service";

/**
 * `POST /api/admin/orders/[orderNumber]/returns` — an operator records a
 * return or exchange the customer asked for by email or phone (plan §5
 * Phase 10, task 7). The customer's own checks apply, plus an audit row.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/returns">) {
  return handleAdmin(request, "orders/returns", async (admin, requestId) => {
    const { orderNumber } = await context.params;
    const input = await parseJsonBody(request, adminReturnRequestSchema);
    return { return: await createReturnAsAdmin(admin.actor, orderNumber, input, requestId) };
  });
}
