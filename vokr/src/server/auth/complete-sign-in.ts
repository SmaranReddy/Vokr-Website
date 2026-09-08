import type { NextRequest } from "next/server";

import { prisma } from "@/server/db/client";

import { getOrCreateAppUser } from "./app-user";
import { GUEST_COOKIE_NAME, clearGuestCookie } from "./guest";
import type { CookieWrite } from "./supabase";
import { hashGuestToken } from "./tokens";
import { runGuestUpgradeHandlers } from "./upgrade";

/**
 * Runs the guest → authenticated transition (plan §5 Phase 3, task 7) and
 * ensures the `app_users` row exists (task 8). Shared by the password
 * sign-in route and the OAuth callback route — both are "a guest becomes a
 * signed-in user" events with identical follow-up work.
 *
 * If a guest cookie is present and still names a live `guest_sessions`
 * row, the registered upgrade handlers (Phase 5 registers cart merge) run
 * inside the same transaction that deletes the guest session, and the
 * guest cookie is cleared on the response — invalidating the old guest
 * token and rotating the cookie, which is what prevents session fixation
 * across the identity change.
 */
export async function completeSignIn(params: {
  request: NextRequest;
  cookiesToSet: CookieWrite[];
  userId: string;
  userEmail: string;
}): Promise<void> {
  const { request, cookiesToSet, userId, userEmail } = params;

  const guestToken = request.cookies.get(GUEST_COOKIE_NAME)?.value;
  if (guestToken) {
    const guestSession = await prisma.guestSession.findUnique({
      where: { tokenHash: hashGuestToken(guestToken) },
      select: { id: true },
    });
    if (guestSession) {
      await prisma.$transaction(async (tx) => {
        await runGuestUpgradeHandlers({
          guestSessionId: guestSession.id,
          userId,
          tx,
        });
        await tx.guestSession.deleteMany({ where: { id: guestSession.id } });
      });
    }
    cookiesToSet.push(clearGuestCookie());
  }

  await getOrCreateAppUser({ id: userId, email: userEmail });
}
