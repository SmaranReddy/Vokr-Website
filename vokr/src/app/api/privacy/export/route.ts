import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { requireUser } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { getClientIp } from "@/server/net/client-ip";
import { requestIdOf } from "@/server/net/request-id";
import { exportAccountData } from "@/server/privacy/export";
import { assertWithinRateLimit } from "@/server/rate-limit";

/**
 * `POST /api/privacy/export` — everything held about the signed-in
 * account, as a JSON download (plan §5 Phase 17, task 4; DPDP). POST, so
 * the proxy's cross-site refusal applies and a link cannot trigger it.
 * Rate limited per account and per IP; nothing is stored.
 */
export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];
  try {
    const user = await requireUser(request);
    cookiesToSet = user.cookiesToSet;
    await assertWithinRateLimit({ key: `privacy:export:ip:${getClientIp(request)}`, limit: 10, windowMs: 60 * 60 * 1000 });
    await assertWithinRateLimit({ key: `privacy:export:user:${user.userId}`, limit: 5, windowMs: 60 * 60 * 1000 });
    const data = await exportAccountData(user.userId);
    console.info(`[privacy] EXPORT user=${user.userId} orders=${data.orders.length}`);
    return applyCookies(
      new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="vokr-my-data-${data.generatedAt.slice(0, 10)}.json"`,
          "cache-control": "no-store",
        },
      }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("privacy/export", requestId, error);
    return applyCookies(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), cookiesToSet);
  }
}
