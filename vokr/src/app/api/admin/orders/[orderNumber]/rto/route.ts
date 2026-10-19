import type { NextRequest } from "next/server";

import { handleAdmin, parseJsonBody } from "@/server/admin/route";
import { receiveRto, rtoReceiveSchema } from "@/server/returns/service";

/**
 * `POST /api/admin/orders/[orderNumber]/rto` — a failed delivery is back:
 * quality check and restock decision per item (plan §5 Phase 10, task 6).
 * The order must already be `rto`.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/rto">) {
  return handleAdmin(request, "orders/rto", async (admin, requestId) => {
    const { orderNumber } = await context.params;
    const input = await parseJsonBody(request, rtoReceiveSchema);
    return await receiveRto(admin.actor, orderNumber, input, requestId);
  });
}
