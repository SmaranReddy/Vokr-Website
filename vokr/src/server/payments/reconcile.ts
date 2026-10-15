import { CheckoutState, PaymentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { applyPaymentObservation, toPaymentStatus, type ApplyOutcome } from "./apply";
import type { RazorpayClient, RazorpayPayment } from "./razorpay";

export const RECONCILE_AFTER_MS = 30 * 60 * 1000;

/**
 * Most-advanced attempt first, so one capture among several failed attempts
 * wins. `refunded` is deliberately absent: it is Razorpay's payment
 * *summary*, which can read `refunded` while the refund is still pending,
 * and also for an authorization that was released without ever being
 * captured. Neither is proof that money went back, so a summary never
 * moves a payment or closes an issue here — only refund entities do
 * (`late-payment.ts`, or a `refund.processed` webhook's refund entity).
 */
const ATTEMPT_PRIORITY: Readonly<Partial<Record<PaymentStatus, number>>> = {
  [PaymentStatus.captured]: 3,
  [PaymentStatus.authorized]: 2,
  [PaymentStatus.failed]: 1,
};

function mostAdvancedAttempt(payments: readonly RazorpayPayment[]) {
  return payments
    .map((payment) => ({ payment, status: toPaymentStatus(payment.status) }))
    .filter(
      (entry): entry is { payment: RazorpayPayment; status: PaymentStatus } =>
        !!entry.status && ATTEMPT_PRIORITY[entry.status] !== undefined,
    )
    .sort((a, b) => (ATTEMPT_PRIORITY[b.status] ?? 0) - (ATTEMPT_PRIORITY[a.status] ?? 0))[0];
}

export interface ReconcileReport {
  checked: number;
  outcomes: ApplyOutcome[];
  /**
   * Orders that could not be read or applied this run. Each is isolated:
   * the rest of the batch still runs, and the job reports the run as
   * failed so it is retried and seen.
   */
  errors: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
 * only the apply step is transactional. One order that cannot be read or
 * applied is logged and counted, never allowed to stop the others.
 * Driven by the Phase 8 maintenance job (`POST /api/jobs/maintenance`,
 * OIDC-authenticated Cloud Scheduler).
 */
export async function reconcilePendingPayments(
  razorpay: RazorpayClient,
  now: Date = new Date(),
): Promise<ReconcileReport> {
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
  let errors = 0;
  for (const payment of pending) {
    const orderId = payment.providerOrderId as string;
    try {
      const outcome = await reconcileOrder(razorpay, orderId);
      if (!outcome) continue;
      console.info(
        `[payments/reconcile] payment=${payment.id} razorpay_order=${orderId} outcome=${outcome.kind}`,
      );
      outcomes.push(outcome);
    } catch (error) {
      errors += 1;
      console.error(
        `[payments/reconcile] RECONCILE_FAILED payment=${payment.id} razorpay_order=${orderId}: ${messageOf(error)}`,
      );
    }
  }
  return { checked: pending.length, outcomes, errors };
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
 * An order that fails is still stamped as checked, so it moves to the back
 * of the queue and is retried after the interval: it can never sit at the
 * head of the batch and starve every order behind it.
 *
 * A `refunded` attempt is deliberately *not* applied here (see
 * {@link ATTEMPT_PRIORITY}).
 */
export async function reconcileClosedOrders(
  razorpay: RazorpayClient,
  now: Date = new Date(),
): Promise<ReconcileReport> {
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
  let errors = 0;
  for (const payment of due) {
    const orderId = payment.providerOrderId as string;
    try {
      const attempts = (await razorpay.listOrderPayments(orderId))
        .map((attempt) => ({ attempt, status: toPaymentStatus(attempt.status) }))
        .filter((entry): entry is { attempt: RazorpayPayment; status: PaymentStatus } =>
          entry.status === PaymentStatus.authorized || entry.status === PaymentStatus.captured,
        )
        .sort((a, b) => (ATTEMPT_PRIORITY[b.status] ?? 0) - (ATTEMPT_PRIORITY[a.status] ?? 0));
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
    } catch (error) {
      errors += 1;
      console.error(
        `[payments/reconcile] RECONCILE_FAILED closed payment=${payment.id} razorpay_order=${orderId}: ${messageOf(error)}`,
      );
    }
    // Stamped on failure too: the order is retried after the interval
    // rather than blocking the head of every later batch.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { lateCheckedAt: now },
      select: { id: true },
    });
  }
  return { checked: due.length, outcomes, errors };
}
