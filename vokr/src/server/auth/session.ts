import type { NextRequest } from "next/server";

import { UnauthorizedError } from "@/lib/errors";

import { getOrCreateAppUser } from "./app-user";
import {
  GUEST_COOKIE_NAME,
  clearGuestCookie,
  getOrCreateGuestSession,
} from "./guest";
import { createRouteSupabaseClient, type CookieWrite } from "./supabase";

export type Identity =
  | { type: "user"; userId: string; email: string }
  | { type: "guest"; guestSessionId: string };

export interface SessionResolution {
  identity: Identity;
  /** Apply to the outgoing response via {@link applyCookies} from `./supabase`. */
  cookiesToSet: CookieWrite[];
}

/**
 * Resolves the caller's identity for one request. Every request resolves
 * to exactly one identity — an authenticated user or a guest session,
 * never both, never neither (plan §5 Phase 3, task 6). A guest cookie
 * found alongside a valid Supabase session is stale (e.g. the sign-in
 * response that should have cleared it was never received by the
 * browser) and is cleared rather than trusted.
 */
export async function getSession(
  request: NextRequest,
): Promise<SessionResolution> {
  const { supabase, cookiesToSet } = createRouteSupabaseClient(request);

  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    const email = data.user.email ?? "";
    const appUser = await getOrCreateAppUser({ id: data.user.id, email });
    // An erased account (plan §5 Phase 17) keeps its Supabase Auth user until
    // an operator deletes it with the service-role key. Until then a valid
    // token for it must not act as that account: it is a guest.
    if (appUser.deletedAt !== null) {
      console.warn(`[auth] ERASED_ACCOUNT_SESSION user=${data.user.id} treated as signed out`);
      return getGuestSession(request, cookiesToSet);
    }

    if (request.cookies.get(GUEST_COOKIE_NAME)) {
      cookiesToSet.push(clearGuestCookie());
    }

    return {
      identity: { type: "user", userId: data.user.id, email },
      cookiesToSet,
    };
  }

  return getGuestSession(request, cookiesToSet);
}

async function getGuestSession(request: NextRequest, cookiesToSet: CookieWrite[]): Promise<SessionResolution> {
  const guestToken = request.cookies.get(GUEST_COOKIE_NAME)?.value;
  const guestResolution = await getOrCreateGuestSession(guestToken);
  if (guestResolution.setCookie) {
    cookiesToSet.push(guestResolution.setCookie);
  }

  return {
    identity: { type: "guest", guestSessionId: guestResolution.guestSessionId },
    cookiesToSet,
  };
}

/** Resolves the session and throws {@link UnauthorizedError} unless the caller is a signed-in user. */
export async function requireUser(request: NextRequest): Promise<{
  userId: string;
  email: string;
  cookiesToSet: CookieWrite[];
}> {
  const { identity, cookiesToSet } = await getSession(request);
  if (identity.type !== "user") {
    throw new UnauthorizedError("Sign in required.");
  }
  return { userId: identity.userId, email: identity.email, cookiesToSet };
}
