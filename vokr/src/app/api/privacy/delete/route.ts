import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { requireUser } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { getClientIp } from "@/server/net/client-ip";
import { requestIdOf } from "@/server/net/request-id";
import { requestErasure } from "@/server/privacy/erasure";
import { assertWithinRateLimit } from "@/server/rate-limit";

const bodySchema = z.object({ confirm: z.literal(true) }).strict();

/**
 * `POST /api/privacy/delete` — the signed-in customer asks for their
 * account to be erased (plan §5 Phase 17, tasks 5–6). **Records a request
 * only**: an operator reviews a dry run and approves before anything is
 * anonymised, so a hijacked session cannot erase an account by itself.
 * Idempotent (one open request per account); rate limited; POST, so the
 * proxy's cross-site refusal applies.
 */
export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];
  try {
    const user = await requireUser(request);
    cookiesToSet = user.cookiesToSet;
    await assertWithinRateLimit({ key: `privacy:delete:ip:${getClientIp(request)}`, limit: 10, windowMs: 60 * 60 * 1000 });
    await assertWithinRateLimit({ key: `privacy:delete:user:${user.userId}`, limit: 3, windowMs: 60 * 60 * 1000 });
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new ValidationError("Request body must be JSON.");
    }
    if (!bodySchema.safeParse(raw).success) throw new ValidationError("Confirm the request with { \"confirm\": true }.");
    const { request: row, created } = await requestErasure(user.userId);
    return applyCookies(
      NextResponse.json(
        { request: { id: row.id, state: row.state, createdAt: row.createdAt.toISOString() }, created },
        { status: created ? 202 : 200, headers: { "cache-control": "no-store" } },
      ),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("privacy/delete", requestId, error);
    return applyCookies(NextResponse.json(body, { status, headers: { "cache-control": "no-store" } }), cookiesToSet);
  }
}
