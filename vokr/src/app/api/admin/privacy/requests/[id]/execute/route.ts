import type { NextRequest } from "next/server";

import { ADMIN_REAUTH_MAX_AGE_S } from "@/server/admin/guard";
import { handleAdmin } from "@/server/admin/route";
import { executeErasure } from "@/server/privacy/erasure";

/**
 * `POST /api/admin/privacy/requests/[id]/execute` — anonymise an approved
 * request in place. Answers 409 while `ERASURE_EXECUTION_ENABLED` is off
 * (until legal review). Recent sign-in; audited.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/privacy/requests/[id]/execute">) {
  return handleAdmin(
    request,
    "privacy/execute",
    async (admin, requestId) => {
      const { id } = await context.params;
      return await executeErasure(admin.actor, id, { requestId });
    },
    { reauthWithinS: ADMIN_REAUTH_MAX_AGE_S },
  );
}
