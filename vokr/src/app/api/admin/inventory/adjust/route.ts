import type { NextRequest } from "next/server";

import { adjustInventory, adjustInventorySchema } from "@/server/admin/inventory";
import { handleAdmin, parseJsonBody } from "@/server/admin/route";

/** `POST /api/admin/inventory/adjust` — change a variant's on-hand stock, with a reason; audit-logged (plan §5 Phase 12, task 5). */
export async function POST(request: NextRequest) {
  return handleAdmin(request, "inventory/adjust", async (admin, requestId) => {
    const input = await parseJsonBody(request, adjustInventorySchema);
    return { inventory: await adjustInventory(admin.actor, input, requestId) };
  });
}
