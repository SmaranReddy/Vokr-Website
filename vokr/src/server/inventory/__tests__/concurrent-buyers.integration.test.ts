import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ReservationState } from "@/generated/prisma/enums";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";

import { InsufficientStockError } from "../holds";
import { cleanupCheckoutFixtures, newCheckoutFixtures, pricedSession, stockedVariant, stockOf } from "./checkout-fixtures";

/**
 * R10 at the database layer: 10 / 25 / 50 concurrent buyers of one variant
 * with 3 units left. "Zero oversell, zero duplicates, zero deadlocks, zero
 * 5xx" — here: exactly 3 holds, every other buyer a clean out-of-stock
 * answer (no lock timeout, deadlock or other error), stock never negative.
 *
 * This is the reservation transaction itself under real Postgres row
 * locks. The HTTP-level k6 run against a deployed environment (R10's
 * full evidence) still needs a staging environment with ordering enabled.
 */

const STOCK = 3;
const fixtures = newCheckoutFixtures();

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("R10 — concurrent buyers of one variant", () => {
  it.each([10, 25, 50])(
    "%i buyers for %i units: exactly the stock is held, the rest are cleanly refused",
    async (buyers) => {
      const variantId = await stockedVariant(fixtures, STOCK);
      const sessions = [];
      for (let index = 0; index < buyers; index += 1) {
        sessions.push(await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }] }));
      }

      const started = Date.now();
      const results = await Promise.allSettled(
        sessions.map(({ identity, sessionId }) => reserveCheckoutSession(identity, sessionId)),
      );
      const elapsedMs = Date.now() - started;

      const granted = results.filter((result) => result.status === "fulfilled");
      const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const unexpected = refused.filter((result) => !(result.reason instanceof InsufficientStockError));

      expect(unexpected.map((result) => String(result.reason))).toEqual([]); // no deadlock, lock timeout or 5xx-class error
      expect(granted).toHaveLength(STOCK);
      expect(refused).toHaveLength(buyers - STOCK);
      expect(await stockOf(variantId)).toEqual({ quantityOnHand: STOCK, quantityReserved: STOCK });
      expect(await prisma.inventoryReservation.count({ where: { variantId, state: ReservationState.held } })).toBe(STOCK);
      // Each granted session holds exactly one unit — no duplicate holds.
      const perSession = await prisma.inventoryReservation.groupBy({
        by: ["checkoutSessionId"],
        where: { variantId, state: ReservationState.held },
        _sum: { quantity: true },
      });
      expect(perSession.every((row) => row._sum.quantity === 1)).toBe(true);
      console.info(`[R10] buyers=${buyers} stock=${STOCK} granted=${granted.length} refused=${refused.length} elapsed_ms=${elapsedMs}`);
    },
    60_000,
  );
});
