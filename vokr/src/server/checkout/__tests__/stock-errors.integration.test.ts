import { afterAll, afterEach, describe, expect, it } from "vitest";

import { toErrorResponse } from "@/lib/errors";
import { addItem } from "@/server/cart";
import { invalidateCatalogCache } from "@/server/catalog";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  guest,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";

import { reserveCheckoutSession } from "../reserve";

/**
 * What a browser is told when stock or a reservation is no longer there:
 * a 409 with a specific code (and, for stock, the short lines), so the UI
 * can mark the right line or restart checkout instead of parsing a
 * message. The checks themselves are server-side, against the database,
 * whatever page or cart state the browser still holds.
 */

const fixtures = newCheckoutFixtures();

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (rejection: unknown) => rejection,
  );
  return toErrorResponse(error);
}

describe("OUT_OF_STOCK", () => {
  it("adding to a line refuses when the whole line, not just the new units, exceeds stock", async () => {
    const variantId = await stockedVariant(fixtures, 3);
    invalidateCatalogCache();
    const identity = await guest(fixtures);
    await addItem(identity, { variantId, quantity: 2 });

    const { status, body } = await failure(addItem(identity, { variantId, quantity: 2 }));

    expect(status).toBe(409);
    expect(body.error.code).toBe("OUT_OF_STOCK");
    expect(body.error.details).toEqual({ unavailable: [{ variantId, requested: 4, available: 3 }] });
    const items = await prisma.cartItem.findMany({
      where: { variantId },
      select: { quantity: true },
    });
    expect(items).toEqual([{ quantity: 2 }]);
  });

  it("a reservation for more than is left names the short line", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 2 }] });

    const { status, body } = await failure(reserveCheckoutSession(identity, sessionId));

    expect(status).toBe(409);
    expect(body.error.code).toBe("OUT_OF_STOCK");
    expect(body.error.details).toEqual({ unavailable: [{ variantId, requested: 2, available: 1 }] });
  });
});

describe("RESERVATION_EXPIRED and CHECKOUT_STALE", () => {
  it("a lapsed hold is RESERVATION_EXPIRED", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await reserveCheckoutSession(identity, sessionId);
    await prisma.$executeRaw`
      UPDATE checkout_sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sessionId}::uuid
    `;

    const { body } = await failure(reserveCheckoutSession(identity, sessionId));

    expect(body.error.code).toBe("RESERVATION_EXPIRED");
  });

  it("a bag changed since pricing is CHECKOUT_STALE", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId, cartId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await prisma.cartItem.updateMany({ where: { cartId }, data: { quantity: 2 } });

    const { body } = await failure(reserveCheckoutSession(identity, sessionId));

    expect(body.error.code).toBe("CHECKOUT_STALE");
  });

  it("expired pricing is CHECKOUT_STALE", async () => {
    const variantId = await stockedVariant(fixtures, 5);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] });
    await prisma.$executeRaw`
      UPDATE checkout_sessions SET expires_at = now() - interval '1 minute' WHERE id = ${sessionId}::uuid
    `;

    const { body } = await failure(reserveCheckoutSession(identity, sessionId));

    expect(body.error.code).toBe("CHECKOUT_STALE");
  });
});
