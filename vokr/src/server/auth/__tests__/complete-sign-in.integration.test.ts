import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { completeSignIn } from "@/server/auth/complete-sign-in";
import {
  GUEST_COOKIE_NAME,
  getOrCreateGuestSession,
} from "@/server/auth/guest";
import type { CookieWrite } from "@/server/auth/supabase";
import {
  __resetGuestUpgradeHandlersForTests,
  registerGuestUpgradeHandler,
} from "@/server/auth/upgrade";
import { prisma } from "@/server/db/client";

/**
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`.
 *
 * Cleanup is scoped to the exact rows this file creates, not a table-wide
 * `deleteMany({})` — `guest` and `app-user`'s integration suites touch
 * these same tables and run concurrently with this file.
 */

const createdGuestSessionIds: string[] = [];
const createdAppUserIds: string[] = [];

function requestWithGuestCookie(rawToken?: string): NextRequest {
  return new NextRequest("https://vokr.shop/api/auth/signin", {
    headers: rawToken ? { cookie: `${GUEST_COOKIE_NAME}=${rawToken}` } : {},
  });
}

async function trackedGuestSession() {
  const result = await getOrCreateGuestSession(undefined);
  createdGuestSessionIds.push(result.guestSessionId);
  return result;
}

function trackedUserId(): string {
  const id = randomUUID();
  createdAppUserIds.push(id);
  return id;
}

beforeEach(() => {
  __resetGuestUpgradeHandlersForTests();
});

afterEach(async () => {
  await prisma.guestSession.deleteMany({
    where: { id: { in: createdGuestSessionIds } },
  });
  await prisma.appUser.deleteMany({ where: { id: { in: createdAppUserIds } } });
  createdGuestSessionIds.length = 0;
  createdAppUserIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("completeSignIn (Phase 3, tasks 7 + 8)", () => {
  it("runs the registered upgrade handler, deletes the guest session, and clears the cookie", async () => {
    const guest = await trackedGuestSession();
    const rawToken = guest.setCookie!.value;

    let handlerRanWith: { guestSessionId: string; userId: string } | undefined;
    registerGuestUpgradeHandler(async (ctx) => {
      handlerRanWith = {
        guestSessionId: ctx.guestSessionId,
        userId: ctx.userId,
      };
    });

    const userId = trackedUserId();
    const cookiesToSet: CookieWrite[] = [];
    await completeSignIn({
      request: requestWithGuestCookie(rawToken),
      cookiesToSet,
      userId,
      userEmail: `${userId}@example.com`,
    });

    expect(handlerRanWith).toEqual({
      guestSessionId: guest.guestSessionId,
      userId,
    });

    await expect(
      prisma.guestSession.findUnique({ where: { id: guest.guestSessionId } }),
    ).resolves.toBeNull();

    expect(cookiesToSet).toContainEqual(
      expect.objectContaining({ name: GUEST_COOKIE_NAME, value: "" }),
    );

    await expect(
      prisma.appUser.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toMatchObject({ email: `${userId}@example.com` });
  });

  it("still creates the app_users row, with no cookie writes, when there is no guest cookie", async () => {
    const userId = trackedUserId();
    const cookiesToSet: CookieWrite[] = [];

    await completeSignIn({
      request: requestWithGuestCookie(),
      cookiesToSet,
      userId,
      userEmail: `${userId}@example.com`,
    });

    expect(cookiesToSet).toHaveLength(0);
    await expect(
      prisma.appUser.findUniqueOrThrow({ where: { id: userId } }),
    ).resolves.toBeTruthy();
  });

  it("clears the cookie without error when the guest cookie names a session that no longer exists", async () => {
    const userId = trackedUserId();
    const cookiesToSet: CookieWrite[] = [];

    await completeSignIn({
      request: requestWithGuestCookie("f".repeat(64)),
      cookiesToSet,
      userId,
      userEmail: `${userId}@example.com`,
    });

    expect(cookiesToSet).toContainEqual(
      expect.objectContaining({ name: GUEST_COOKIE_NAME, value: "" }),
    );
  });

  it("a retried sign-in with the same guest token does not re-run the upgrade handler", async () => {
    const guest = await trackedGuestSession();
    const rawToken = guest.setCookie!.value;

    let runCount = 0;
    registerGuestUpgradeHandler(async () => {
      runCount += 1;
    });

    const userId = trackedUserId();
    await completeSignIn({
      request: requestWithGuestCookie(rawToken),
      cookiesToSet: [],
      userId,
      userEmail: `${userId}@example.com`,
    });
    await completeSignIn({
      request: requestWithGuestCookie(rawToken),
      cookiesToSet: [],
      userId,
      userEmail: `${userId}@example.com`,
    });

    expect(runCount).toBe(1);
  });
});
