import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

import {
  MAX_CART_ITEM_QUANTITY,
  addItem,
  clearCart,
  getCart,
  pruneAbandonedCarts,
  removeItem,
  updateQuantity,
} from "../service";
import {
  createActiveVariantFixture,
  deactivateVariantFixture,
  deleteVariantFixture,
} from "./fixtures";

/**
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`.
 *
 * Cleanup is scoped to the identities and product fixtures this file
 * creates, not a table-wide `deleteMany({})` — other integration suites
 * touch `app_users` and `guest_sessions` concurrently.
 */

const createdAppUserIds: string[] = [];
const createdGuestSessionIds: string[] = [];
const createdProductIds: string[] = [];

async function guestIdentity(): Promise<Identity> {
  const guestSessionId = randomUUID();
  await prisma.guestSession.create({
    data: {
      id: guestSessionId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  createdGuestSessionIds.push(guestSessionId);
  return { type: "guest", guestSessionId };
}

afterEach(async () => {
  const carts = await prisma.cart.findMany({
    where: {
      OR: [
        { userId: { in: createdAppUserIds } },
        { guestSessionId: { in: createdGuestSessionIds } },
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cart service (plan §5 Phase 5)", () => {
  it("addItem creates a cart on first use and prices the line only from product_variants (R6)", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Shoe",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);

    const before = await getCart(identity);
    expect(before).toEqual({ cartId: null, items: [], subtotalPaise: 0, taxPaise: 0, totalPaise: 0 });

    const cart = await addItem(identity, { variantId: fixture.variantId, quantity: 2 });

    expect(cart.cartId).not.toBeNull();
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      variantId: fixture.variantId,
      quantity: 2,
      available: true,
      unitPricePaise: 999_500,
      lineSubtotalPaise: 999_500 * 2,
    });
    expect(cart.subtotalPaise).toBe(999_500 * 2);

    // Persisted row stores no price at all.
    const row = await prisma.cartItem.findFirstOrThrow({
      where: { variantId: fixture.variantId },
      select: { quantity: true },
    });
    expect(row.quantity).toBe(2);
  });

  it("addItem on an existing line sums quantities, capped at the per-line maximum", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Laces",
      category: "accessories",
      gstRateBps: 500,
      pricePaise: 29_500,
      quantityOnHand: 50,
    });
    createdProductIds.push(fixture.productId);

    await addItem(identity, { variantId: fixture.variantId, quantity: 6 });
    const cart = await addItem(identity, { variantId: fixture.variantId, quantity: 6 });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(MAX_CART_ITEM_QUANTITY);
  });

  it("addItem rejects a quantity outside 1-10", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Socks",
      category: "accessories",
      gstRateBps: 500,
      pricePaise: 49_500,
    });
    createdProductIds.push(fixture.productId);

    await expect(
      addItem(identity, { variantId: fixture.variantId, quantity: 11 }),
    ).rejects.toThrow(ValidationError);
  });

  it("addItem rejects insufficient advisory stock", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Low Stock",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 899_500,
      quantityOnHand: 2,
    });
    createdProductIds.push(fixture.productId);

    await expect(
      addItem(identity, { variantId: fixture.variantId, quantity: 3 }),
    ).rejects.toThrow(ConflictError);
  });

  it("addItem rejects an unknown or not-yet-purchasable variant", async () => {
    const identity = await guestIdentity();
    await expect(
      addItem(identity, { variantId: randomUUID(), quantity: 1 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("updateQuantity changes the line and rejects insufficient stock", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Update",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 599_500,
      quantityOnHand: 5,
    });
    createdProductIds.push(fixture.productId);

    const added = await addItem(identity, { variantId: fixture.variantId, quantity: 2 });
    const cartItemId = added.items[0]!.cartItemId;

    const updated = await updateQuantity(identity, cartItemId, 4);
    expect(updated.items[0]!.quantity).toBe(4);

    await expect(updateQuantity(identity, cartItemId, 6)).rejects.toThrow(ConflictError);
  });

  it("updateQuantity and removeItem return NotFoundError for another identity's item — no existence disclosure", async () => {
    const owner = await guestIdentity();
    const stranger = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test IDOR",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 799_500,
    });
    createdProductIds.push(fixture.productId);

    const cart = await addItem(owner, { variantId: fixture.variantId, quantity: 1 });
    const cartItemId = cart.items[0]!.cartItemId;

    await expect(updateQuantity(stranger, cartItemId, 2)).rejects.toThrow(NotFoundError);
    await expect(removeItem(stranger, cartItemId)).rejects.toThrow(NotFoundError);

    // Untouched by the rejected attempts.
    const after = await getCart(owner);
    expect(after.items[0]!.quantity).toBe(1);
  });

  it("removeItem deletes the line; clearCart empties all lines and leaves the cart open", async () => {
    const identity = await guestIdentity();
    const fixtureA = await createActiveVariantFixture({
      name: "Test Remove A",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    const fixtureB = await createActiveVariantFixture({
      name: "Test Remove B",
      category: "accessories",
      gstRateBps: 500,
      pricePaise: 29_500,
    });
    createdProductIds.push(fixtureA.productId, fixtureB.productId);

    await addItem(identity, { variantId: fixtureA.variantId, quantity: 1 });
    const cart = await addItem(identity, { variantId: fixtureB.variantId, quantity: 1 });
    expect(cart.items).toHaveLength(2);

    const afterRemove = await removeItem(identity, cart.items[0]!.cartItemId);
    expect(afterRemove.items).toHaveLength(1);

    const afterClear = await clearCart(identity);
    expect(afterClear.items).toHaveLength(0);
    expect(afterClear.cartId).toBe(cart.cartId);
  });

  it("the partial unique index enforces one open cart per user identity", async () => {
    const userId = randomUUID();
    await prisma.appUser.create({
      data: { id: userId, email: `${userId}@example.com` },
      select: { id: true },
    });
    createdAppUserIds.push(userId);

    await prisma.cart.create({ data: { userId }, select: { id: true } });
    await expect(
      prisma.cart.create({ data: { userId }, select: { id: true } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("getCart marks a variant deactivated after being added as unavailable and excludes it from totals", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Deactivated",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);

    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });
    await deactivateVariantFixture(fixture.variantId);

    const cart = await getCart(identity);
    expect(cart.items[0]).toEqual({
      cartItemId: cart.items[0]!.cartItemId,
      variantId: fixture.variantId,
      quantity: 1,
      available: false,
    });
    expect(cart.subtotalPaise).toBe(0);
  });

  it("pruneAbandonedCarts deletes carts (and their items) untouched for 30 days, and spares a fresh one", async () => {
    const stale = await guestIdentity();
    const fresh = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Prune",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);

    const staleCart = await addItem(stale, { variantId: fixture.variantId, quantity: 1 });
    await addItem(fresh, { variantId: fixture.variantId, quantity: 1 });

    await prisma.cart.update({
      where: { id: staleCart.cartId! },
      data: { updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      select: { id: true },
    });

    const result = await pruneAbandonedCarts();
    expect(result.cartsDeleted).toBeGreaterThanOrEqual(1);

    await expect(
      prisma.cart.findUnique({ where: { id: staleCart.cartId! } }),
    ).resolves.toBeNull();

    const freshCart = await getCart(fresh);
    expect(freshCart.items).toHaveLength(1);
  });
});
