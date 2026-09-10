import type { NextRequest } from "next/server";

import { prisma } from "@/server/db/client";
// Side-effect only: registers the Phase 5 cart-merge handler against the
// upgrade hook below, before it can possibly run. See that module's
// comment for why this is the import site.
import "@/server/cart/register-merge-handler";

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
 * The `app_users` row is created *before* any upgrade handler runs, not
 * after — a handler (Phase 5's cart merge) writes rows with a real FK to
 * `app_users(id)`, and that FK cannot be satisfied by a row that does not
 * exist yet. Getting this ordering wrong surfaces immediately as a
 * foreign-key violation the moment a guest with a cart signs in for the
 * first time, which is how this ordering was corrected.
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

  await getOrCreateAppUser({ id: userId, email: userEmail });

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
}
