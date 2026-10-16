import type { NextRequest } from "next/server";

import { revealOrderPii, revealSchema } from "@/server/admin/orders";
import { handleAdmin, parseJsonBody } from "@/server/admin/route";

/** `POST /api/admin/orders/[orderNumber]/reveal` — the customer's contact and address; the reveal itself is audit-logged (plan §5 Phase 12, task 7). */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/orders/[orderNumber]/reveal">) {
  return handleAdmin(request, "orders/reveal", async (admin, requestId) => {
    const { orderNumber } = await context.params;
    const { reason } = await parseJsonBody(request, revealSchema);
    return { customer: await revealOrderPii(admin.actor, orderNumber, reason, requestId) };
  });
}
