import type { NextRequest } from "next/server";
import { z } from "zod";

import { NotFoundError } from "@/lib/errors";
import { ADMIN_REAUTH_MAX_AGE_S } from "@/server/admin/guard";
import { handleAdmin, parseInput, parseJsonBody } from "@/server/admin/route";
import { recordManualRefund, recordManualRefundSchema, refundReturn, refundReturnSchema } from "@/server/returns/service";

const refundActionSchema = z.object({ action: z.enum(["refund", "record"]), input: z.unknown() }).strict();

/**
 * `POST /api/admin/returns/[returnId]/refund` — settle a received return's
 * money (`refund`: the whole-order refund is queued, anything less is
 * recorded as due) or record the dashboard refund made for a due amount
 * (`record`). Both need a sign-in in the last 15 minutes and the order
 * number retyped. No Razorpay call is made here.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/returns/[returnId]/refund">) {
  return handleAdmin(
    request,
    "returns/refund",
    async (admin, requestId) => {
      const { returnId } = await context.params;
      if (!z.uuid().safeParse(returnId).success) throw new NotFoundError("Return not found.");
      const { action, input } = await parseJsonBody(request, refundActionSchema);
      return action === "refund"
        ? await refundReturn(admin.actor, returnId, parseInput(refundReturnSchema, input), requestId)
        : await recordManualRefund(admin.actor, returnId, parseInput(recordManualRefundSchema, input), requestId);
    },
    { reauthWithinS: ADMIN_REAUTH_MAX_AGE_S },
  );
}
