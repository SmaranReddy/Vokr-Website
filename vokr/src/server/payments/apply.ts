import { CheckoutState, PaymentStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { commitHolds } from "@/server/inventory";

import { nextPaymentStatus } from "./state-machine";

/** A fact about one Razorpay payment attempt — from a verified webhook or from the reconciliation job's API read. */
export interface PaymentObservation {
  providerOrderId: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountPaise: number;
  currency: string;
}

export type ApplyOutcome =
  | {
      kind: "applied";
      paymentId: string;
      from: PaymentStatus;
      to: PaymentStatus;
      /** Set when the payment moved but something around it needs a human. */
      warning?: string;
    }
  | { kind: "ignored"; paymentId: string; reason: string }
  | { kind: "rejected"; reason: string };

/** Maps Razorpay's payment `status` string; `created` (no attempt outcome yet) and anything unknown map to `null`. */
export function toPaymentStatus(razorpayStatus: string): PaymentStatus | null {
  switch (razorpayStatus) {
    case "authorized":
      return PaymentStatus.authorized;
    case "captured":
      return PaymentStatus.captured;
    case "failed":
      return PaymentStatus.failed;
    case "refunded":
      return PaymentStatus.refunded;
    default:
      return null;
  }
}

/**
 * Applies one observation to the local `payments` row, inside the caller's
 * transaction. The row is locked first (`FOR UPDATE`), so two events for
 * the same order — delivered concurrently and in either order — serialise
 * and converge on the same final state.
 *
 * Amount and currency are checked against the row, which was copied from
 * the pricing snapshot: a capture for any other amount is refused and
 * recorded, never treated as payment for the order.
 *
 * On a first capture the checkout session moves `payment_pending → paid`
 * and its stock holds are committed (Phase 8), in this one transaction.
 * A capture that arrives after the session left `payment_pending` (it
 * expired, say) still records the money, and is reported as such so it
 * can be reconciled or refunded — it is never dropped, never marks the
 * session paid, and never touches stock that was already released.
 *
 * Lock order: this `payments` row, then the session (by the update), then
 * inventory rows — the same order the maintenance job's release uses.
 */
export async function applyPaymentObservation(
  tx: Prisma.TransactionClient,
  observation: PaymentObservation,
): Promise<ApplyOutcome> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM payments WHERE provider_order_id = ${observation.providerOrderId} FOR UPDATE
  `;
  const paymentId = locked[0]?.id;
  if (!paymentId) {
    return { kind: "rejected", reason: `no local payment for order ${observation.providerOrderId}` };
  }

  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { status: true, amountPaise: true, currency: true, checkoutSessionId: true },
  });

  if (observation.amountPaise !== payment.amountPaise || observation.currency !== payment.currency) {
    console.error(
      `[payments] payment=${paymentId} AMOUNT MISMATCH expected=${payment.amountPaise} ${payment.currency} got=${observation.amountPaise} ${observation.currency}`,
    );
    return {
      kind: "rejected",
      reason: `amount mismatch: expected ${payment.amountPaise} ${payment.currency}, got ${observation.amountPaise} ${observation.currency}`,
    };
  }

  const next = nextPaymentStatus(payment.status, observation.status);
  if (!next) {
    return {
      kind: "ignored",
      paymentId,
      reason: `stale or repeated: ${payment.status} -> ${observation.status}`,
    };
  }

  await tx.payment.update({
    where: { id: paymentId },
    data: { status: next, providerPaymentId: observation.providerPaymentId },
    select: { id: true },
  });
  console.info(
    `[payments] payment=${paymentId} transition ${payment.status} -> ${next} amount=${payment.amountPaise}`,
  );

  let warning: string | undefined;
  if (next === PaymentStatus.captured) {
    const moved = await tx.checkoutSession.updateMany({
      where: { id: payment.checkoutSessionId, state: CheckoutState.payment_pending },
      data: { state: CheckoutState.paid },
    });
    if (moved.count === 1) {
      console.info(
        `[checkout] session=${payment.checkoutSessionId} transition payment_pending -> paid`,
      );
      // Same transaction as `→ paid`: the held units leave stock exactly
      // when the session becomes paid, never separately.
      const committed = await commitHolds(tx, payment.checkoutSessionId);
      if (committed === 0) {
        warning = `captured but checkout session ${payment.checkoutSessionId} had no held stock — needs reconciliation`;
        console.error(`[payments] payment=${paymentId} ${warning}`);
      }
    } else {
      warning = `captured but checkout session ${payment.checkoutSessionId} was not payment_pending — needs reconciliation`;
      console.error(`[payments] payment=${paymentId} ${warning}`);
    }
  }

  return { kind: "applied", paymentId, from: payment.status, to: next, warning };
}
