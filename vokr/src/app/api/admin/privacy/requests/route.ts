import type { NextRequest } from "next/server";

import { handleAdmin } from "@/server/admin/route";
import { listOpenErasureRequests } from "@/server/privacy/erasure";

/** `GET /api/admin/privacy/requests` — erasure requests awaiting a decision or execution, oldest first. */
export async function GET(request: NextRequest) {
  return handleAdmin(request, "privacy/requests", async () => ({ requests: await listOpenErasureRequests() }));
}
