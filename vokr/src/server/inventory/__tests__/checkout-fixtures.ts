import { randomUUID } from "node:crypto";

import { CheckoutState } from "@/generated/prisma/enums";
import type { Identity } from "@/server/auth/session";
import { createActiveVariantFixture, deleteVariantFixture } from "@/server/cart/__tests__/fixtures";
import { prisma } from "@/server/db/client";

/**
 * Real rows for checkout-path integration tests: an active variant with
 * stock, a guest with an open cart holding the given lines, and a checkout
 * session in `priced` whose snapshot names exactly those lines. Pricing
 * itself is Phase 6's tested step; the snapshot here carries only what the
 * reservation and payment steps read (`lines`, `totalPaise`).
 */

export interface CheckoutFixtures {
  guestSessionIds: string[];
  productIds: string[];
}

export function newCheckoutFixtures(): CheckoutFixtures {
  return { guestSessionIds: [], productIds: [] };
}

export async function stockedVariant(
  fixtures: CheckoutFixtures,
  quantityOnHand: number,
  pricePaise = 999_500,
): Promise<string> {
  const variant = await createActiveVariantFixture({
    name: "Reservation fixture",
    category: "Test",
    gstRateBps: 1800,
    pricePaise,
    quantityOnHand,
  });
  fixtures.productIds.push(variant.productId);
  return variant.variantId;
}

export async function guest(fixtures: CheckoutFixtures): Promise<Identity & { type: "guest" }> {
  const guestSessionId = randomUUID();
  await prisma.guestSession.create({
    data: { id: guestSessionId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) },
    select: { id: true },
  });
  fixtures.guestSessionIds.push(guestSessionId);
  return { type: "guest", guestSessionId };
}

export async function pricedSession(
  fixtures: CheckoutFixtures,
  input: {
    lines: { variantId: string; quantity: number }[];
    totalPaise?: number;
    paymentMethod?: "prepaid" | "cod";
    identity?: Identity & { type: "guest" };
  },
): Promise<{ identity: Identity & { type: "guest" }; sessionId: string; cartId: string }> {
  const identity = input.identity ?? (await guest(fixtures));
  const cart =
    (await prisma.cart.findFirst({
      where: { guestSessionId: identity.guestSessionId, status: "open" },
      select: { id: true },
    })) ?? (await prisma.cart.create({ data: { guestSessionId: identity.guestSessionId }, select: { id: true } }));
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cartItem.createMany({
    data: input.lines.map((line) => ({ cartId: cart.id, variantId: line.variantId, quantity: line.quantity })),
  });

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const session = await prisma.checkoutSession.create({
    data: {
      cartId: cart.id,
      guestSessionId: identity.guestSessionId,
      idempotencyKey: randomUUID(),
      state: CheckoutState.priced,
      paymentMethod: input.paymentMethod ?? "prepaid",
      pricingSnapshot: {
        totalPaise: input.totalPaise ?? 999_500,
        lines: input.lines,
        expiresAt: expiresAt.toISOString(),
      },
      expiresAt,
    },
    select: { id: true },
  });
  return { identity, sessionId: session.id, cartId: cart.id };
}

export async function stockOf(variantId: string) {
  return prisma.inventory.findUniqueOrThrow({
    where: { variantId },
    select: { quantityOnHand: true, quantityReserved: true },
  });
}

/** Deletes everything the fixtures created, children first. */
export async function cleanupCheckoutFixtures(fixtures: CheckoutFixtures, extraEventIds: string[] = []): Promise<void> {
  if (extraEventIds.length > 0) {
    await prisma.webhookEvent.deleteMany({ where: { providerEventId: { in: extraEventIds } } });
  }
  const sessions = await prisma.checkoutSession.findMany({
    where: { guestSessionId: { in: fixtures.guestSessionIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((session) => session.id);
  await prisma.inventoryReservation.deleteMany({ where: { checkoutSessionId: { in: sessionIds } } });
  await prisma.payment.deleteMany({ where: { checkoutSessionId: { in: sessionIds } } });
  await prisma.checkoutSession.deleteMany({ where: { id: { in: sessionIds } } });
  const carts = await prisma.cart.findMany({
    where: { guestSessionId: { in: fixtures.guestSessionIds } },
    select: { id: true },
  });
  await prisma.cartItem.deleteMany({ where: { cartId: { in: carts.map((cart) => cart.id) } } });
  await prisma.cart.deleteMany({ where: { id: { in: carts.map((cart) => cart.id) } } });
  await prisma.guestSession.deleteMany({ where: { id: { in: fixtures.guestSessionIds } } });
  for (const productId of fixtures.productIds) {
    await prisma.inventoryReservation.deleteMany({ where: { variant: { productId } } });
    await deleteVariantFixture(productId);
  }
  fixtures.guestSessionIds.length = 0;
  fixtures.productIds.length = 0;
}
