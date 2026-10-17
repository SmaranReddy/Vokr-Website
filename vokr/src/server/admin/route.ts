import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import { toErrorResponse, ValidationError } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { requestIdOf } from "@/server/net/request-id";
import { assertWithinRateLimit } from "@/server/rate-limit";

import { requireAdmin, type AdminContext } from "./guard";

/** Per-admin ceiling on admin API calls (plan §5 Phase 12: "all rate limited"). Generous for a person, tight for a script. */
export const ADMIN_RATE_LIMIT = { limit: 120, windowMs: 60 * 1000 };

/**
 * Every `/api/admin/**` handler runs through this: admin check (404 for
 * anyone else), per-admin rate limit, uniform error body, `no-store`.
 */
export async function handleAdmin(
  request: NextRequest,
  scope: string,
  body: (admin: AdminContext, requestId: string) => Promise<Response | Record<string, unknown>>,
  options: { reauthWithinS?: number } = {},
): Promise<Response> {
  let cookiesToSet: CookieWrite[] = [];
  const requestId = requestIdOf(request);
  try {
    const admin = await requireAdmin(request, options);
    cookiesToSet = admin.cookiesToSet;
    await assertWithinRateLimit({ key: `admin:${admin.adminId}`, ...ADMIN_RATE_LIMIT });
    const result = await body(admin, requestId);
    const response = result instanceof Response ? result : NextResponse.json(result);
    response.headers.set("cache-control", "no-store");
    return applyCookies(response as NextResponse, cookiesToSet);
  } catch (error) {
    const mapped = toErrorResponse(error, requestId);
    logServerError(`admin/${scope}`, mapped.requestId, error);
    return applyCookies(
      NextResponse.json(mapped.body, { status: mapped.status, headers: { "cache-control": "no-store" } }),
      cookiesToSet,
    );
  }
}

/** Parses a JSON body against a strict schema; any failure is a 400 with the first issue. */
export async function parseJsonBody<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.");
  }
  return parsed.data;
}

/** A value already taken from a parsed body (e.g. an action's `input`) against its own schema; same 400 as {@link parseJsonBody}. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid request.");
  }
  return parsed.data;
}
