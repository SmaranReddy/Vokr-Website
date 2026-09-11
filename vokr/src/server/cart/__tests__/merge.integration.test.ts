import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { completeSignIn } from "@/server/auth/complete-sign-in";
import { GUEST_COOKIE_NAME, getOrCreateGuestSession } from "@/server/auth/guest";
import type { CookieWrite } from "@/server/auth/supabase";
import {
  __resetGuestUpgradeHandlersForTests,
  registerGuestUpgradeHandler,
} from "@/server/auth/upgrade";
import { prisma } from "@/server/db/client";

import { getCart } from "../service";
import { mergeGuestCartIntoUserCart } from "../merge";
import { createActiveVariantFixture, deleteVariantFixture } from "./fixtures";

/**
 * Requires a running Postgres with migrations applied. Run via
 * `npm run test:integration`.
 *
 * `__resetGuestUpgradeHandlersForTests()` (Phase 3) clears whatever the
 * process-wide `register-merge-handler.ts` side-effect import already
 * registered, so every test here re-registers the real
 * `mergeGuestCartIntoUserCart` explicitly — this file is testing that
 * handler's own logic, not the registration mechanism (already covered
 * by `src/server/auth/__tests__/complete-sign-in.integration.test.ts`).
 */

const createdAppUserIds: string[] = [];
const createdGuestSessionIds: string[] = [];
const createdProductIds: string[] = [];
// A closed guest cart's `guest_session_id` is nulled (FK ON DELETE SET
// NULL) the moment its guest session is deleted — which `completeSignIn`
// does immediately after merging — so it stops matching the
// `guestSessionId: { in: createdGuestSessionIds } }` lookup below. Cart
// ids created directly by a test's own setup are tracked here instead.
const createdCartIds: string[] = [];

async function trackedGuestSession(): Promise<{ guestSessionId: string; rawToken: string }> {
  const result = await getOrCreateGuestSession(undefined);
  createdGuestSessionIds.push(result.guestSessionId);
  return { guestSessionId: result.guestSessionId, rawToken: result.setCookie!.value };
}

function trackedUserId(): string {
  const id = randomUUID();
  createdAppUserIds.push(id);
  return id;
}

function requestWithGuestCookie(rawToken: string): NextRequest {
  return new NextRequest("https://vokr.shop/api/auth/signin", {
    headers: { cookie: `${GUEST_COOKIE_NAME}=${rawToken}` },
  });
}

beforeEach(() => {
  __resetGuestUpgradeHandlersForTests();
  registerGuestUpgradeHandler(mergeGuestCartIntoUserCart);
});

afterEach(async () => {
  const carts = await prisma.cart.findMany({
    where: {
      OR: [
        { userId: { in: createdAppUserIds } },
        { guestSessionId: { in: createdGuestSessionIds } },
        { id: { in: createdCartIds } },
      ],
    },
    select: { id: true },
  });
  const cartIds = carts.map((cart) => cart.id);
  if (cartIds.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } });
    await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
  }
  await prisma.guestSession.deleteMany({ where: { id: { in: createdGuestSessionIds } } });
  await prisma.appUser.deleteMany({ where: { id: { in: createdAppUserIds } } });
  for (const productId of createdProductIds) {
    await deleteVariantFixture(productId);
  }
  createdAppUserIds.length = 0;
  createdGuestSessionIds.length = 0;
  createdProductIds.length = 0;
  createdCartIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("mergeGuestCartIntoUserCart (plan §5 Phase 5, task 5)", () => {
  it("unions the guest cart into a fresh user cart on sign-in", async () => {
    const guest = await trackedGuestSession();
    const fixture = await createActiveVariantFixture({
      name: "Test Merge",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
      quantityOnHand: 20,
    });
    createdProductIds.push(fixture.productId);

    await prisma.cart.create({
      data: { guestSessionId: guest.guestSessionId },
      select: { id: true },
    });
    const guestCartId = (
      await prisma.cart.findFirstOrThrow({
        where: { guestSessionId: guest.guestSessionId },
        select: { id: true },
      })
    ).id;
    createdCartIds.push(guestCartId);
    await prisma.cartItem.create({
      data: { cartId: guestCartId, variantId: fixture.variantId, quantity: 3 },
      select: { id: true },
    });

    const userId = trackedUserId();
    const cookiesToSet: CookieWrite[] = [];
    await completeSignIn({
      request: requestWithGuestCookie(guest.rawToken),
      cookiesToSet,
      userId,
      userEmail: `${userId}@example.com`,
    });

    const userCart = await getCart({ type: "user", userId, email: `${userId}@example.com` });
    expect(userCart.items).toHaveLength(1);
    expect(userCart.items[0]!.quantity).toBe(3);

    // Guest cart closed, not left open (frees the partial-unique slot).
    const guestCartRow = await prisma.cart.findUniqueOrThrow({ where: { id: guestCartId } });
    expect(guestCartRow.status).toBe("closed");
  });

  it("sums an overlapping variant with the user's existing cart, capped at the per-line maximum", async () => {
    const guest = await trackedGuestSession();
    const fixture = await createActiveVariantFixture({
      name: "Test Merge Sum",
      category: "accessories",
      gstRateBps: 500,
      pricePaise: 29_500,
      quantityOnHand: 50,
    });
    createdProductIds.push(fixture.productId);

    const userId = trackedUserId();
    await prisma.appUser.create({
      data: { id: userId, email: `${userId}@example.com` },
      select: { id: true },
    });
    const userCartBefore = await prisma.cart.create({
      data: { userId },
      select: { id: true },
    });
    createdCartIds.push(userCartBefore.id);
    await prisma.cartItem.create({
      data: { cartId: userCartBefore.id, variantId: fixture.variantId, quantity: 7 },
      select: { id: true },
    });

    const guestCart = await prisma.cart.create({
      data: { guestSessionId: guest.guestSessionId },
      select: { id: true },
    });
    createdCartIds.push(guestCart.id);
    await prisma.cartItem.create({
      data: { cartId: guestCart.id, variantId: fixture.variantId, quantity: 8 },
      select: { id: true },
    });

    await completeSignIn({
      request: requestWithGuestCookie(guest.rawToken),
      cookiesToSet: [],
      userId,
      userEmail: `${userId}@example.com`,
    });

    const userCart = await getCart({ type: "user", userId, email: `${userId}@example.com` });
    expect(userCart.items).toHaveLength(1);
    expect(userCart.items[0]!.quantity).toBe(10); // min(7 + 8, 10)
  });

  it("a genuinely concurrent double-fired sign-in merges the guest cart at most once", async () => {
    const guest = await trackedGuestSession();
    const fixture = await createActiveVariantFixture({
      name: "Test Merge Concurrent",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 499_500,
      quantityOnHand: 20,
    });
    createdProductIds.push(fixture.productId);

    const guestCart = await prisma.cart.create({
      data: { guestSessionId: guest.guestSessionId },
      select: { id: true },
    });
    createdCartIds.push(guestCart.id);
    await prisma.cartItem.create({
      data: { cartId: guestCart.id, variantId: fixture.variantId, quantity: 2 },
      select: { id: true },
    });

    const userId = trackedUserId();
    // `completeSignIn` normally guarantees this row exists before any
    // handler runs — bypassed here, so created directly.
    await prisma.appUser.create({
      data: { id: userId, email: `${userId}@example.com` },
      select: { id: true },
    });

    // Two transactions racing the same merge, bypassing `completeSignIn`'s
    // own "session already deleted" guard so this test exercises only the
    // `SELECT ... FOR UPDATE` guard inside `mergeGuestCartIntoUserCart`
    // itself.
    await Promise.all([
      prisma.$transaction((tx) =>
        mergeGuestCartIntoUserCart({ guestSessionId: guest.guestSessionId, userId, tx }),
      ),
      prisma.$transaction((tx) =>
        mergeGuestCartIntoUserCart({ guestSessionId: guest.guestSessionId, userId, tx }),
      ),
    ]);

    const userCart = await getCart({ type: "user", userId, email: `${userId}@example.com` });
    expect(userCart.items).toHaveLength(1);
    expect(userCart.items[0]!.quantity).toBe(2); // not 4 — merged exactly once
  });

  it("is a no-op when the guest has no open cart", async () => {
    const guest = await trackedGuestSession();
    const userId = trackedUserId();

    await completeSignIn({
      request: requestWithGuestCookie(guest.rawToken),
      cookiesToSet: [],
      userId,
      userEmail: `${userId}@example.com`,
    });

    const userCart = await getCart({ type: "user", userId, email: `${userId}@example.com` });
    expect(userCart.items).toHaveLength(0);
  });
});
