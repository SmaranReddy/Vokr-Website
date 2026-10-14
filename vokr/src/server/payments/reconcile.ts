import { CheckoutState, PaymentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { applyPaymentObservation, toPaymentStatus, type ApplyOutcome } from "./apply";
import type { RazorpayClient, RazorpayPayment } from "./razorpay";

export const RECONCILE_AFTER_MS = 30 * 60 * 1000;

/** Most-advanced attempt first, so one capture among several failed attempts wins. */
const ATTEMPT_PRIORITY: Readonly<Record<PaymentStatus, number>> = {
  [PaymentStatus.refunded]: 4,
  [PaymentStatus.captured]: 3,
  [PaymentStatus.authorized]: 2,
  [PaymentStatus.failed]: 1,
  [PaymentStatus.created]: 0,
};

function mostAdvancedAttempt(payments: readonly RazorpayPayment[]) {
  return payments
    .map((payment) => ({ payment, status: toPaymentStatus(payment.status) }))
    .filter((entry): entry is { payment: RazorpayPayment; status: PaymentStatus } => !!entry.status)
    .sort((a, b) => ATTEMPT_PRIORITY[b.status] - ATTEMPT_PRIORITY[a.status])[0];
}

/**
 * Covers the webhook that never arrives (plan §5 Phase 7, task 10): every
 * checkout session still `payment_pending` more than 30 minutes after its
 * Razorpay order was created is re-read from Razorpay's API, and the
 * most-advanced attempt is applied through exactly the same path a
 * verified webhook uses — so the two sources can never disagree about
 * what a fact means.
 *
 * Network calls happen one session at a time, outside any transaction;
 * only the apply step is transactional. Driven by the Phase 8 maintenance
 * job (`POST /api/jobs/maintenance`, OIDC-authenticated Cloud Scheduler).
 */
export async function reconcilePendingPayments(
  razorpay: RazorpayClient,
  now: Date = new Date(),
): Promise<{ checked: number; outcomes: ApplyOutcome[] }> {
  const pending = await prisma.payment.findMany({
    where: {
      providerOrderId: { not: null },
      createdAt: { lte: new Date(now.getTime() - RECONCILE_AFTER_MS) },
      checkoutSession: { state: CheckoutState.payment_pending },
    },
    select: { id: true, providerOrderId: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const outcomes: ApplyOutcome[] = [];
  for (const payment of pending) {
    const orderId = payment.providerOrderId as string;
    const outcome = await reconcileOrder(razorpay, orderId);
    if (!outcome) continue;
    console.info(
      `[payments/reconcile] payment=${payment.id} razorpay_order=${orderId} outcome=${outcome.kind}`,
    );
    outcomes.push(outcome);
  }
  return { checked: pending.length, outcomes };
}

/**
 * Reads one Razorpay order's attempts and applies the most advanced one
 * through {@link applyPaymentObservation} — the network read first, outside
 * any transaction, then a short transaction for the apply. `null` when
 * Razorpay reports no attempt with an outcome yet.
 */
export async function reconcileOrder(
  razorpay: RazorpayClient,
  providerOrderId: string,
): Promise<ApplyOutcome | null> {
  return applyOrderAttempts(providerOrderId, await razorpay.listOrderPayments(providerOrderId));
}

/**
 * {@link reconcileOrder} for attempts the caller has already read — the
 * maintenance job reads them once, applies them here, and also inspects
 * them itself before it releases a hold that has a Razorpay order.
 */
export async function applyOrderAttempts(
  providerOrderId: string,
  attempts: readonly RazorpayPayment[],
): Promise<ApplyOutcome | null> {
  const attempt = mostAdvancedAttempt(attempts);
  if (!attempt) return null;
  return prisma.$transaction((tx) =>
    applyPaymentObservation(tx, {
      providerOrderId,
      providerPaymentId: attempt.payment.id,
      status: attempt.status,
      amountPaise: attempt.payment.amount,
      currency: attempt.payment.currency,
    }),
  );
}

/** Razorpay polls banks for up to 3 days; a day of margin on top. */
export const LATE_PAYMENT_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
/** How often one closed order is re-read while inside that window. */
export const LATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The webhook that never arrives, for an order whose session already
 * closed (plan §5 Phase 8, Open 5). {@link reconcilePendingPayments} only
 * looks at `payment_pending` sessions; a late authorization or capture
 * for an `expired` session, or a second payment on a `paid` one, would
 * otherwise go unseen without a webhook.
 *
 * Every order with a Razorpay order created in the last
 * {@link LATE_PAYMENT_WINDOW_MS}, whose session is no longer
 * `payment_pending`, is re-read at most every {@link LATE_CHECK_INTERVAL_MS}.
 * Every attempt that is `authorized` or `captured` is applied through the
 * same path a webhook uses, most advanced first, so the order's own
 * payment is settled before any extra one is judged against it. Never
 * touches stock: the apply path only commits holds that still exist.
 *
 * A `refunded` attempt is deliberately *not* applied here. That status is
 * the payment's summary, which may already say `refunded` while the refund
 * is still pending; closing an issue on it could hide a refund that later
 * fails. Refunds close only from refund entities (`late-payment.ts`) or a
 * `refund.processed` webhook.
 */
export async function reconcileClosedOrders(
  razorpay: RazorpayClient,
  now: Date = new Date(),
): Promise<{ checked: number; outcomes: ApplyOutcome[] }> {
  const due = await prisma.payment.findMany({
    where: {
      providerOrderId: { not: null },
      createdAt: { gte: new Date(now.getTime() - LATE_PAYMENT_WINDOW_MS) },
      checkoutSession: { state: { not: CheckoutState.payment_pending } },
      OR: [{ lateCheckedAt: null }, { lateCheckedAt: { lte: new Date(now.getTime() - LATE_CHECK_INTERVAL_MS) } }],
    },
    select: { id: true, providerOrderId: true },
    orderBy: [{ lateCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 50,
  });

  const outcomes: ApplyOutcome[] = [];
  for (const payment of due) {
    const orderId = payment.providerOrderId as string;
    const attempts = (await razorpay.listOrderPayments(orderId))
      .map((attempt) => ({ attempt, status: toPaymentStatus(attempt.status) }))
      .filter((entry): entry is { attempt: RazorpayPayment; status: PaymentStatus } =>
        entry.status === PaymentStatus.authorized || entry.status === PaymentStatus.captured,
      )
      .sort((a, b) => ATTEMPT_PRIORITY[b.status] - ATTEMPT_PRIORITY[a.status]);
    for (const { attempt, status } of attempts) {
      const outcome = await prisma.$transaction((tx) =>
        applyPaymentObservation(tx, {
          providerOrderId: orderId,
          providerPaymentId: attempt.id,
          status,
          amountPaise: attempt.amount,
          currency: attempt.currency,
        }),
      );
      outcomes.push(outcome);
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { lateCheckedAt: now },
      select: { id: true },
    });
  }
  return { checked: due.length, outcomes };
}
