import type { NextRequest } from "next/server";

import { handleAdmin } from "@/server/admin/route";
import { previewErasure } from "@/server/privacy/erasure";

/** `GET /api/admin/privacy/requests/[id]` — the dry-run report: what would be anonymised, kept, and what blocks it. Changes nothing. */
export async function GET(request: NextRequest, context: RouteContext<"/api/admin/privacy/requests/[id]">) {
  return handleAdmin(request, "privacy/preview", async () => {
    const { id } = await context.params;
    return await previewErasure(id);
  });
}
