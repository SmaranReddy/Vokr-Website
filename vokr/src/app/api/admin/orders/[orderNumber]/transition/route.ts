import type { NextRequest } from "next/server";

import { adminTransitionOrder, transitionSchema } from "@/server/admin/orders";
import { handleAdmin, parseJsonBody } from "@/server/admin/route";

/** `POST /api/admin/orders/[orderNumber]/transition` — move an order through the state machine; `shipped` records courier + AWB (plan §5 Phase 12, task 4; Phase 10, task 3). */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/transition">) {
  return handleAdmin(request, "orders/transition", async (admin, requestId) => {
    const { orderNumber } = await context.params;
    const input = await parseJsonBody(request, transitionSchema);
    return await adminTransitionOrder(admin.actor, orderNumber, input, requestId);
  });
}
