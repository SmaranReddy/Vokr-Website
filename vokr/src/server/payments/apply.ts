import { CheckoutState, PaymentStatus, ReservationState } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { commitHolds } from "@/server/inventory";

import { closeIssueAsRefunded, recordPaymentIssue } from "./payment-issues";
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
  | {
      kind: "ignored";
      paymentId: string;
      reason: string;
      /** Set when the order did not move but the money needs a human or a refund. */
      warning?: string;
    }
  | {
      kind: "rejected";
      reason: string;
      /** Set when money moved that this server cannot match to its order: a person must look. */
      warning?: string;
    };

/** Log tag for a Razorpay payment on an order this server has no record of — never refunded automatically. */
export const UNMATCHED_PAYMENT_TAG = "UNMATCHED_PAYMENT";

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
 * and its stock holds are committed (Phase 8), in this one transaction —
 * but only when the session still holds stock, read under the session's
 * lock before anything changes.
 *
 * Money that arrives (`authorized` or `captured`) for a session that holds
 * no stock — it expired, or its holds are gone — is still recorded, never
 * marks the session paid and never touches stock. In the same transaction
 * it opens one durable `payment_issues` row, which the maintenance job
 * refunds once Razorpay reports the payment captured (`late-payment.ts`).
 * A full refund observed here closes that issue.
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
    // Not an order this server created (another integration on the same
    // Razorpay account, or a dashboard payment link): it may not be Vokr's
    // money to refund. The verified webhook row keeps the redacted facts
    // durably (`prune.ts` never deletes a row that failed to apply), and
    // money-moving statuses are logged under a stable tag for alerting.
    const reason = `no local payment for order ${observation.providerOrderId}`;
    const moved = observation.status === PaymentStatus.authorized || observation.status === PaymentStatus.captured;
    if (moved) {
      console.error(
        `[payments] ${UNMATCHED_PAYMENT_TAG} razorpay_order=${observation.providerOrderId} razorpay_payment=${observation.providerPaymentId} status=${observation.status} amount=${observation.amountPaise} ${observation.currency}`,
      );
    }
    return {
      kind: "rejected",
      reason,
      warning: moved ? `${UNMATCHED_PAYMENT_TAG}: ${observation.status} on an unknown order — needs a person` : undefined,
    };
  }

  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      status: true,
      amountPaise: true,
      currency: true,
      checkoutSessionId: true,
      providerPaymentId: true,
    },
  });

  if (observation.amountPaise !== payment.amountPaise || observation.currency !== payment.currency) {
    const reason = `amount mismatch: expected ${payment.amountPaise} ${payment.currency}, got ${observation.amountPaise} ${observation.currency}`;
    console.error(`[payments] payment=${paymentId} AMOUNT MISMATCH ${reason}`);
    // Money that moved for the wrong amount never pays the order. It gets a
    // durable issue straight in `manual_review` — the resolver would refuse
    // to refund a mismatch on its own anyway — which the maintenance job
    // watches and closes once a processed refund covers it. The amount is
    // what Razorpay holds, so that is what must go back.
    const moved = observation.status === PaymentStatus.authorized || observation.status === PaymentStatus.captured;
    if (moved && observation.amountPaise > 0 && observation.currency === "INR") {
      await recordPaymentIssue(tx, {
        paymentId,
        providerPaymentId: observation.providerPaymentId,
        amountPaise: observation.amountPaise,
        currency: observation.currency,
        reason: "amount_mismatch",
        manualReview: reason,
      });
    } else if (moved) {
      console.error(`[payments] payment=${paymentId} ${UNMATCHED_PAYMENT_TAG} cannot record an issue for ${reason}`);
    }
    return {
      kind: "rejected",
      reason,
      warning: moved ? `${observation.status} for the wrong amount — issue in manual review` : undefined,
    };
  }

  // A different payment (attempt) on an order already settled by another
  // one: a customer who paid twice from the same Checkout. The order keeps
  // its payment and its stock; the extra money gets its own issue, and a
  // refund of it never touches the order's row.
  const settled = payment.status === PaymentStatus.captured || payment.status === PaymentStatus.refunded;
  if (settled && payment.providerPaymentId && payment.providerPaymentId !== observation.providerPaymentId) {
    if (observation.status === PaymentStatus.authorized || observation.status === PaymentStatus.captured) {
      await recordPaymentIssue(tx, {
        paymentId,
        providerPaymentId: observation.providerPaymentId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        reason: "additional_payment",
      });
      const warning = `${observation.status} a second payment on an order already ${payment.status} — needs reconciliation; refund issue opened`;
      console.error(`[payments] payment=${paymentId} ${warning}`);
      return { kind: "ignored", paymentId, reason: "additional payment on a settled order", warning };
    }
    if (observation.status === PaymentStatus.refunded) {
      await closeIssueAsRefunded(tx, observation.providerPaymentId);
    }
    return { kind: "ignored", paymentId, reason: `another attempt's ${observation.status}; the order's payment is unchanged` };
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
  if (next === PaymentStatus.captured || next === PaymentStatus.authorized) {
    const sessionId = payment.checkoutSessionId;
    // Session lock second (payment → session → inventory), and the holds
    // read under it: the expiry job takes the same locks before releasing.
    const [session] = await tx.$queryRaw<{ state: CheckoutState }[]>`
      SELECT state FROM checkout_sessions WHERE id = ${sessionId}::uuid FOR UPDATE
    `;
    const heldLines = await tx.inventoryReservation.count({
      where: { checkoutSessionId: sessionId, state: ReservationState.held },
    });

    let issueReason: string | null = null;
    if (session?.state === CheckoutState.payment_pending && heldLines > 0) {
      if (next === PaymentStatus.captured) {
        await tx.checkoutSession.update({
          where: { id: sessionId },
          data: { state: CheckoutState.paid },
          select: { id: true },
        });
        console.info(`[checkout] session=${sessionId} transition payment_pending -> paid`);
        // Same transaction as `→ paid`: the held units leave stock exactly
        // when the session becomes paid, never separately.
        await commitHolds(tx, sessionId);
      }
      // `authorized` with stock still held is the normal path: the capture follows.
    } else if (session?.state === CheckoutState.payment_pending) {
      // Nothing left to fulfil from. Never `paid`: the session ends here.
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: { state: CheckoutState.expired },
        select: { id: true },
      });
      console.error(`[checkout] session=${sessionId} transition payment_pending -> expired (no held stock)`);
      issueReason = "no_held_stock";
    } else if (session?.state !== CheckoutState.paid) {
      issueReason = `session_${session?.state ?? "missing"}`;
    }

    if (issueReason) {
      await recordPaymentIssue(tx, {
        paymentId,
        providerPaymentId: observation.providerPaymentId,
        amountPaise: payment.amountPaise,
        currency: payment.currency,
        reason: issueReason,
      });
      warning = `${next} but checkout session ${sessionId} holds no stock (${issueReason}) — needs reconciliation; refund issue opened`;
      console.error(`[payments] payment=${paymentId} ${warning}`);
    }
  } else if (next === PaymentStatus.refunded) {
    await closeIssueAsRefunded(tx, observation.providerPaymentId);
  }

  return { kind: "applied", paymentId, from: payment.status, to: next, warning };
}
