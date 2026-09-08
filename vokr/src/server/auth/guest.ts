import { prisma } from "@/server/db/client";

import { generateGuestToken, hashGuestToken } from "./tokens";

/** Name of the HttpOnly cookie carrying the raw guest token. */
export const GUEST_COOKIE_NAME = "vokr_guest";

const GUEST_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — plan §3.5.

export interface GuestCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export interface CookieWrite {
  name: string;
  value: string;
  options: GuestCookieOptions;
}

function cookieOptions(maxAgeSeconds: number): GuestCookieOptions {
  return {
    httpOnly: true,
    // Always Secure, per the phase spec. Modern browsers (Chrome, Firefox)
    // treat `localhost` as a secure context, so this does not break local
    // development over http://localhost.
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export interface GuestSessionResolution {
  guestSessionId: string;
  /** Present only when a new token was minted and must be written to the response. */
  setCookie?: CookieWrite;
}

/**
 * Resolves the guest identity for `rawTokenFromCookie`. If it names a
 * live, unexpired `guest_sessions` row, that row's `last_seen_at` is
 * bumped and reused. Otherwise (missing, unknown or expired token) a new
 * guest session is minted and a cookie write is returned for the caller
 * to apply to the outgoing response.
 */
export async function getOrCreateGuestSession(
  rawTokenFromCookie: string | undefined,
): Promise<GuestSessionResolution> {
  if (rawTokenFromCookie) {
    const tokenHash = hashGuestToken(rawTokenFromCookie);
    const existing = await prisma.guestSession.findUnique({
      where: { tokenHash },
      select: { id: true, expiresAt: true },
    });
    if (existing && existing.expiresAt.getTime() > Date.now()) {
      await prisma.guestSession.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
        select: { id: true },
      });
      return { guestSessionId: existing.id };
    }
  }

  const rawToken = generateGuestToken();
  const tokenHash = hashGuestToken(rawToken);
  const now = new Date();
  const created = await prisma.guestSession.create({
    data: {
      tokenHash,
      expiresAt: new Date(now.getTime() + GUEST_SESSION_TTL_MS),
    },
    select: { id: true },
  });

  return {
    guestSessionId: created.id,
    setCookie: {
      name: GUEST_COOKIE_NAME,
      value: rawToken,
      options: cookieOptions(GUEST_SESSION_TTL_MS / 1000),
    },
  };
}

/**
 * Deletes a guest session row. Idempotent — `deleteMany` affects zero rows
 * rather than throwing if the session is already gone (e.g. a retried
 * sign-in request racing its own first attempt).
 */
export async function invalidateGuestSession(
  guestSessionId: string,
): Promise<void> {
  await prisma.guestSession.deleteMany({ where: { id: guestSessionId } });
}

/** A cookie write that expires the guest cookie immediately. */
export function clearGuestCookie(): CookieWrite {
  return {
    name: GUEST_COOKIE_NAME,
    value: "",
    options: cookieOptions(0),
  };
}
