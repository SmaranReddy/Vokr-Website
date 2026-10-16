import type { NextRequest } from "next/server";

import { ADMIN_REAUTH_MAX_AGE_S } from "@/server/admin/guard";
import { refundSchema, requestOrderRefund } from "@/server/admin/orders";
import { handleAdmin, parseJsonBody } from "@/server/admin/route";

/**
 * `POST /api/admin/orders/[orderNumber]/refund` — queue a full refund of the
 * order's captured payment (plan §5 Phase 12, task 6). Needs a sign-in in
 * the last 15 minutes and the order number retyped.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/refund">) {
  return handleAdmin(
    request,
    "orders/refund",
    async (admin, requestId) => {
      const { orderNumber } = await context.params;
      const input = await parseJsonBody(request, refundSchema);
      return await requestOrderRefund(admin.actor, orderNumber, input, requestId);
    },
    { reauthWithinS: ADMIN_REAUTH_MAX_AGE_S },
  );
}
