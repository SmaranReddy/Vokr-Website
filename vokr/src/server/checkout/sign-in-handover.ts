import type { GuestUpgradeContext } from "@/server/auth/upgrade";

/**
 * Sign-in deletes the guest session (Phase 3), and `checkout_sessions`
 * references it `ON DELETE SET NULL` under an unconditional one-identity
 * CHECK — so without this, a guest who had ever started checkout could not
 * sign in from that device: the delete violated the CHECK and rolled the
 * whole sign-in back.
 *
 * Inside the sign-in transaction, before the guest row goes, every
 * checkout session of the guest moves to the account, and so does any
 * order made from them that no account owns yet. Proof of ownership is the
 * guest cookie this device holds — the same proof that let it check out —
 * never an email address. An order some account already owns is never
 * moved.
 *
 * Runs before the cart merge, and locks the sessions (by id) first, so a
 * sign-in takes locks in the same order as a payment capture (session,
 * then cart) and the two cannot deadlock. Idempotent: a retried sign-in
 * finds nothing left to move.
 */
export async function handOverGuestCheckouts({ guestSessionId, userId, tx }: GuestUpgradeContext): Promise<void> {
  const sessions = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM checkout_sessions
     WHERE guest_session_id = ${guestSessionId}::uuid
     ORDER BY id
       FOR UPDATE
  `;
  if (sessions.length === 0) return;
  const ids = sessions.map((session) => session.id);

  await tx.checkoutSession.updateMany({
    where: { id: { in: ids } },
    data: { userId, guestSessionId: null },
  });
  const orders = await tx.order.updateMany({
    where: { checkoutSessionId: { in: ids }, userId: null },
    data: { userId },
  });
  console.info(
    `[checkout] sign-in handover guest=${guestSessionId} user=${userId} sessions=${ids.length} orders=${orders.count}`,
  );
}
