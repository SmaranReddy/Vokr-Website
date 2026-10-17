import type { NextRequest } from "next/server";
import { z } from "zod";

import { NotFoundError } from "@/lib/errors";
import { handleAdmin, parseInput, parseJsonBody } from "@/server/admin/route";
import {
  decideReturn,
  decideReturnSchema,
  dispatchReplacement,
  dispatchReplacementSchema,
  receiveReturn,
  receiveReturnSchema,
} from "@/server/returns/service";

const returnActionSchema = z
  .object({ action: z.enum(["decide", "receive", "dispatch"]), input: z.unknown() })
  .strict();

/**
 * `POST /api/admin/returns/[returnId]` — move a return or exchange on
 * (plan §5 Phase 10, tasks 6–7): approve/reject, receive with the quality
 * check and restock decision, or ship an exchange's replacement. Money
 * moves only through `…/refund`, which needs a recent sign-in.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/returns/[returnId]">) {
  return handleAdmin(request, "returns/action", async (admin, requestId) => {
    const { returnId } = await context.params;
    if (!z.uuid().safeParse(returnId).success) throw new NotFoundError("Return not found.");
    const { action, input } = await parseJsonBody(request, returnActionSchema);
    switch (action) {
      case "decide":
        return await decideReturn(admin.actor, returnId, parseInput(decideReturnSchema, input), requestId);
      case "receive":
        return await receiveReturn(admin.actor, returnId, parseInput(receiveReturnSchema, input), requestId);
      case "dispatch":
        return await dispatchReplacement(admin.actor, returnId, parseInput(dispatchReplacementSchema, input), requestId);
    }
  });
}
