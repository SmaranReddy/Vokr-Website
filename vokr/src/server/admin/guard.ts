import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { createRouteSupabaseClient, type CookieWrite } from "@/server/auth/supabase";
import { prisma } from "@/server/db/client";

/**
 * Admin authorisation (plan §5 Phase 12, task 1; Security Requirements).
 *
 * - Checked server-side on every admin request and action, from a verified
 *   Supabase session plus `app_users.is_admin` — never from a client route.
 * - Anyone who is not an admin, signed in or not, gets the same 404 as a
 *   path that does not exist: no login redirect confirms the panel is here.
 * - Sessions are bounded by when *this* session authenticated (the access
 *   token's `amr` timestamps), not by token refreshes: after
 *   {@link ADMIN_SESSION_MAX_AGE_S} the operator signs in again. A refund
 *   needs a sign-in within {@link ADMIN_REAUTH_MAX_AGE_S}.
 *
 * Deviation from "admin_sessions with a short idle timeout": an absolute
 * lifetime on the existing Supabase session gives the same bound without a
 * second session store.
 */

export const ADMIN_SESSION_MAX_AGE_S = 8 * 60 * 60;
export const ADMIN_REAUTH_MAX_AGE_S = 15 * 60;

/** The 404 every non-admin receives — identical to an unknown route's. */
export class AdminNotFoundError extends NotFoundError {
  constructor() {
    super("Not found.");
  }
}

export interface AdminContext {
  adminId: string;
  /** `admin:<id>` — the actor written to history and audit rows. */
  actor: string;
  /** Seconds since this session authenticated. */
  authAgeS: number;
  cookiesToSet: CookieWrite[];
}

/**
 * When this session authenticated, in epoch seconds: the latest `amr`
 * timestamp of the verified access token. Falls back to the user's
 * `last_sign_in_at` (any device) only when the token carries no
 * timestamps. `null` means unknown — callers fail closed.
 */
export function sessionAuthTime(amr: unknown, lastSignInAt: string | undefined): number | null {
  if (Array.isArray(amr)) {
    const stamps = amr
      .map((entry) => (entry && typeof entry === "object" ? (entry as { timestamp?: unknown }).timestamp : undefined))
      .filter((stamp): stamp is number => typeof stamp === "number" && Number.isFinite(stamp));
    if (stamps.length > 0) return Math.max(...stamps);
  }
  if (lastSignInAt) {
    const ms = Date.parse(lastSignInAt);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

/** Whether a verified user id is an active admin. The one DB check behind every admin surface. */
export async function isActiveAdmin(userId: string): Promise<boolean> {
  const row = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { isAdmin: true, deletedAt: true },
  });
  return row?.isAdmin === true && row.deletedAt === null;
}

/**
 * Shared by the route guard and the page guard: verified user → admin flag
 * → session age. Throws {@link AdminNotFoundError} on any failure.
 */
export async function resolveAdmin(
  supabase: SupabaseClient,
  options: { reauthWithinS?: number; nowS?: number } = {},
): Promise<{ adminId: string; authAgeS: number }> {
  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    user = error ? null : data.user;
  } catch {
    user = null;
  }
  if (!user) throw new AdminNotFoundError();
  if (!(await isActiveAdmin(user.id))) throw new AdminNotFoundError();

  let amr: unknown;
  try {
    const { data } = await supabase.auth.getClaims();
    amr = data?.claims?.sub === user.id ? data.claims.amr : undefined;
  } catch {
    amr = undefined;
  }
  const authTime = sessionAuthTime(amr, user.last_sign_in_at);
  const nowS = options.nowS ?? Math.floor(Date.now() / 1000);
  if (authTime === null) {
    console.warn(`[admin] admin=${user.id} refused: session auth time unknown`);
    throw new AdminNotFoundError();
  }
  const authAgeS = nowS - authTime;
  if (authAgeS > ADMIN_SESSION_MAX_AGE_S) {
    console.info(`[admin] admin=${user.id} refused: session older than ${ADMIN_SESSION_MAX_AGE_S}s`);
    throw new AdminNotFoundError();
  }
  if (options.reauthWithinS !== undefined && authAgeS > options.reauthWithinS) {
    throw new AdminReauthRequiredError();
  }
  return { adminId: user.id, authAgeS };
}

/** 401 for an admin whose sign-in is too old for this action (a refund). Only ever reaches a verified admin. */
export class AdminReauthRequiredError extends UnauthorizedError {
  constructor() {
    super("Sign in again to confirm this action.");
  }
}

/** For `/api/admin/**` route handlers. */
export async function requireAdmin(
  request: NextRequest,
  options: { reauthWithinS?: number } = {},
): Promise<AdminContext> {
  const { supabase, cookiesToSet } = createRouteSupabaseClient(request);
  const { adminId, authAgeS } = await resolveAdmin(supabase, options);
  return { adminId, actor: `admin:${adminId}`, authAgeS, cookiesToSet };
}
