import type { NextRequest } from "next/server";

import { ADMIN_REAUTH_MAX_AGE_S } from "@/server/admin/guard";
import { handleAdmin, parseJsonBody } from "@/server/admin/route";
import { decideErasure, decideErasureSchema } from "@/server/privacy/erasure";

/** `POST /api/admin/privacy/requests/[id]/decide` — approve or reject once; account email retyped; recent sign-in; audited. */
export async function POST(request: NextRequest, context: RouteContext<"/api/admin/privacy/requests/[id]/decide">) {
  return handleAdmin(
    request,
    "privacy/decide",
    async (admin, requestId) => {
      const { id } = await context.params;
      const input = await parseJsonBody(request, decideErasureSchema);
      return await decideErasure(admin.actor, id, input, requestId);
    },
    { reauthWithinS: ADMIN_REAUTH_MAX_AGE_S },
  );
}
