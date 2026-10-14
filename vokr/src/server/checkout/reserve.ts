import { z } from "zod";

import { CheckoutState } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { invalidateCatalogCache } from "@/server/catalog";
import { holdStock, runLockingTransaction, type HoldLine } from "@/server/inventory";
import type { PricingSnapshot } from "@/server/pricing";

import { findOwnedSession, getCheckoutSession, type CheckoutSessionView } from "./service";
import { assertValidCheckoutTransition } from "./state-machine";

interface LockedSessionRow {
  state: CheckoutState;
  cart_id: string;
  pricing_snapshot: PricingSnapshot | null;
  live: boolean | null;
}

/** The priced lines, exactly as the customer will be charged for them — the reservation holds what the snapshot prices, nothing else. */
function snapshotLines(snapshot: PricingSnapshot | null): HoldLine[] {
  const lines = snapshot?.lines ?? [];
  return lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity }));
}

function sameLines(a: readonly HoldLine[], b: readonly HoldLine[]): boolean {
  if (a.length !== b.length) return false;
  const quantities = new Map(a.map((line) => [line.variantId, line.quantity]));
  return b.every((line) => quantities.get(line.variantId) === line.quantity);
}

/**
 * `POST /api/checkout/session/[id]/reserve` (plan §5 Phase 8, tasks 2–5):
 * moves a `priced` session to `reserved` by holding stock for every priced
 * line, for 15 minutes.
 *
 * - The checkout session row is locked first (`FOR UPDATE`), so duplicate
 *   or concurrent requests for the same session serialise: the first
 *   reserves, every later one finds `reserved` and gets the same answer.
 * - Stock is held for the pricing snapshot's lines, and only if the cart
 *   still matches them; a bag changed after pricing must be re-priced, so
 *   the reservation, the Razorpay amount and the order can never disagree.
 * - The session's `expires_at` becomes the hold's expiry, so a Razorpay
 *   order (created only after this returns, outside every lock — R9) can
 *   never be issued against a lapsed hold.
 */
export async function reserveCheckoutSession(
  identity: Identity,
  checkoutSessionId: string,
): Promise<CheckoutSessionView> {
  if (!z.uuid().safeParse(checkoutSessionId).success) {
    throw new NotFoundError("Checkout session not found.");
  }
  await findOwnedSession(identity, checkoutSessionId);

  const reserved = await runLockingTransaction("reserve", async (tx) => {
    const [session] = await tx.$queryRaw<LockedSessionRow[]>`
      SELECT state, cart_id::text AS cart_id, pricing_snapshot, (expires_at > now()) AS live
        FROM checkout_sessions
       WHERE id = ${checkoutSessionId}::uuid
         FOR UPDATE
    `;
    if (!session) throw new NotFoundError("Checkout session not found.");

    if (
      session.state === CheckoutState.reserved ||
      session.state === CheckoutState.payment_pending ||
      session.state === CheckoutState.paid
    ) {
      if (session.state === CheckoutState.reserved && !session.live) {
        throw new ConflictError("Your reservation has lapsed. Please start checkout again.");
      }
      return false;
    }
    if (session.state !== CheckoutState.priced) {
      throw new ConflictError(`Checkout session cannot be reserved from state "${session.state}".`);
    }
    if (!session.live) {
      throw new ConflictError("Checkout pricing has expired. Please review your order again.");
    }

    const lines = snapshotLines(session.pricing_snapshot);
    if (lines.length === 0) {
      throw new ConflictError("Checkout session has nothing to reserve.");
    }

    const cart = await tx.cart.findUnique({
      where: { id: session.cart_id },
      select: { status: true, items: { select: { variantId: true, quantity: true } } },
    });
    if (!cart || cart.status !== "open" || !sameLines(lines, cart.items)) {
      throw new ConflictError("Your bag changed since it was priced. Please review your order again.");
    }

    const { expiresAt } = await holdStock(tx, {
      checkoutSessionId,
      owner:
        identity.type === "user"
          ? { userId: identity.userId }
          : { guestSessionId: identity.guestSessionId },
      lines,
    });

    assertValidCheckoutTransition(checkoutSessionId, CheckoutState.priced, CheckoutState.reserved);
    await tx.checkoutSession.update({
      where: { id: checkoutSessionId },
      data: { state: CheckoutState.reserved, expiresAt },
      select: { id: true },
    });
    return true;
  });

  if (reserved) invalidateCatalogCache();
  return getCheckoutSession(identity, checkoutSessionId);
}
