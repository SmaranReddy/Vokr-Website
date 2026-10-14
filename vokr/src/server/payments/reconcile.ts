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
 * Razorpay reports no attempt with an outcome yet. Also used by the
 * maintenance job before it releases a hold that has a Razorpay order.
 */
export async function reconcileOrder(
  razorpay: RazorpayClient,
  providerOrderId: string,
): Promise<ApplyOutcome | null> {
  const attempt = mostAdvancedAttempt(await razorpay.listOrderPayments(providerOrderId));
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
