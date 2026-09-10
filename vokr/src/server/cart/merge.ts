import { CartStatus } from "@/generated/prisma/enums";
import { MAX_CART_ITEM_QUANTITY } from "@/lib/cart";
import type { GuestUpgradeContext } from "@/server/auth/upgrade";

import { getOrCreateOpenCartId, touchCart } from "./service";

interface GuestCartRow {
  id: string;
}

/**
 * The Phase 5 handler registered against the Phase 3 guest-upgrade hook
 * (plan §5 Phase 5, task 5). Runs inside the same transaction as the
 * guest session's deletion (`src/server/auth/complete-sign-in.ts`).
 *
 * `completeSignIn` already makes a *sequential* retry a no-op (the second
 * call finds the guest session already deleted and never opens a
 * transaction at all). That alone does not cover a genuinely concurrent
 * double-fired sign-in, where both calls can pass that check before
 * either transaction commits. The raw `SELECT ... FOR UPDATE` below locks
 * the guest cart row itself: the second transaction blocks on the first,
 * then re-evaluates its `WHERE status = 'open'` against the now-committed
 * row and finds nothing left to merge.
 */
export async function mergeGuestCartIntoUserCart({
  guestSessionId,
  userId,
  tx,
}: GuestUpgradeContext): Promise<void> {
  const guestCartRows = await tx.$queryRaw<GuestCartRow[]>`
    SELECT id FROM carts
    WHERE guest_session_id = ${guestSessionId} AND status = 'open'
    FOR UPDATE
  `;
  const guestCart = guestCartRows[0];
  if (!guestCart) {
    return;
  }

  const guestItems = await tx.cartItem.findMany({
    where: { cartId: guestCart.id },
    select: { variantId: true, quantity: true },
  });

  if (guestItems.length > 0) {
    const userCartId = await getOrCreateOpenCartId(tx, { userId });

    const userItems = await tx.cartItem.findMany({
      where: { cartId: userCartId },
      select: { id: true, variantId: true, quantity: true },
    });
    const userItemByVariant = new Map(
      userItems.map((item) => [item.variantId, item]),
    );

    for (const guestItem of guestItems) {
      const existing = userItemByVariant.get(guestItem.variantId);
      if (existing) {
        // Summed, capped at the per-line maximum (plan §5 Phase 5, task 5) —
        // never re-runs on retry, since the FOR UPDATE guard above ensures
        // this loop body executes at most once per guest cart.
        const mergedQuantity = Math.min(
          existing.quantity + guestItem.quantity,
          MAX_CART_ITEM_QUANTITY,
        );
        if (mergedQuantity !== existing.quantity) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: mergedQuantity },
            select: { id: true },
          });
        }
      } else {
        await tx.cartItem.create({
          data: {
            cartId: userCartId,
            variantId: guestItem.variantId,
            quantity: Math.min(guestItem.quantity, MAX_CART_ITEM_QUANTITY),
          },
          select: { id: true },
        });
      }
    }

    await touchCart(userCartId, tx);
  }

  // Every guest line has now either been copied or summed into the user
  // cart — leaving the originals in place would double-store them
  // permanently under a `closed` cart AGENTS.md's storage discipline (the
  // 500 MB cliff is cumulative and never resets) has no cleanup path for
  // otherwise, since `updated_at` pruning targets whole abandoned carts,
  // not stray items inside a closed one.
  await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } });

  // Closed, not deleted: kept for audit, and its partial-unique slot frees
  // up immediately for a new open cart under the same (about-to-be-deleted)
  // guest session.
  await tx.cart.update({
    where: { id: guestCart.id },
    data: { status: CartStatus.closed },
    select: { id: true },
  });
}
