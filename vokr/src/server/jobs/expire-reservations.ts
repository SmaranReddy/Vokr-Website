import { CheckoutState, PaymentStatus, ReservationState } from "@/generated/prisma/enums";
import { isValidCheckoutTransition } from "@/server/checkout/state-machine";
import { prisma } from "@/server/db/client";
import { releaseHolds, runLockingTransaction } from "@/server/inventory";
import type { RazorpayClient } from "@/server/payments/razorpay";
import { applyOrderAttempts } from "@/server/payments/reconcile";

/**
 * Extra time a hold is kept past its expiry once a Razorpay order exists
 * for it. A customer who opened Razorpay Checkout just before the hold
 * lapsed may still be completing a UPI or bank flow; releasing at the
 * exact minute would make their payment arrive for stock no longer held.
 */
export const PAYMENT_GRACE_MINUTES = 15;

/** Sessions examined per run; the next run (every few minutes) picks up the rest. */
const BATCH_SIZE = 100;

/** A payment in one of these states may already be money: its hold is never released. */
const MONEY_MAY_HAVE_MOVED: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.authorized,
  PaymentStatus.captured,
  PaymentStatus.refunded,
]);

export type ExpiryOutcome =
  | "expired"
  | "kept_payment_in_progress"
  | "kept_attempt_unfinished"
  | "kept_in_payment_grace"
  | "kept_unverified"
  | "nothing_to_do";

export interface ExpiryReport {
  examined: number;
  outcomes: Record<ExpiryOutcome, number>;
  errors: number;
}

interface LockedPayment {
  status: PaymentStatus;
  provider_order_id: string | null;
}

/**
 * Releases stock held by sessions whose reservation has expired (plan §5
 * Phase 8, tasks 4 and 6), without ever releasing stock for money that may
 * have arrived:
 *
 * 1. A session **without** a Razorpay order is released as soon as its
 *    hold expires — nobody can be paying for it.
 * 2. A session **with** a Razorpay order is left alone until
 *    {@link PAYMENT_GRACE_MINUTES} after expiry, then Razorpay is asked for
 *    the truth first (outside any transaction) and the answer applied
 *    through the Phase 7 path — a capture there commits the hold and marks
 *    the session paid. If Razorpay is not configured or cannot be read,
 *    the hold stays. It also stays while Razorpay lists any attempt that
 *    is not `failed` — one still `created` (a UPI collect or bank page
 *    the customer has not finished), one in a status this code does not
 *    recognise, or a capture the apply refused: none of those prove that
 *    no money is moving, and a later run looks again.
 * 3. The release itself re-checks everything under the locks, in the
 *    shared order (payment → session → inventory): a webhook that landed
 *    between step 2 and the lock is seen, and an `authorized`, `captured`
 *    or `refunded` payment keeps its hold.
 *
 * Every step is conditional on current state, so two overlapping runs, or
 * a retried run, change nothing twice.
 */
export async function expireReservations(razorpay: RazorpayClient | null): Promise<ExpiryReport> {
  const candidates = await prisma.$queryRaw<{ checkout_session_id: string }[]>`
    SELECT DISTINCT checkout_session_id::text AS checkout_session_id
      FROM inventory_reservations
     WHERE state = 'held' AND expires_at <= now()
     ORDER BY checkout_session_id
     LIMIT ${BATCH_SIZE}
  `;

  const report: ExpiryReport = {
    examined: candidates.length,
    outcomes: {
      expired: 0,
      kept_payment_in_progress: 0,
      kept_attempt_unfinished: 0,
      kept_in_payment_grace: 0,
      kept_unverified: 0,
      nothing_to_do: 0,
    },
    errors: 0,
  };

  for (const { checkout_session_id: sessionId } of candidates) {
    try {
      const outcome = await expireSession(sessionId, razorpay);
      report.outcomes[outcome] += 1;
      console.info(`[jobs/expiry] session=${sessionId} outcome=${outcome}`);
    } catch (error) {
      report.errors += 1;
      console.error(`[jobs/expiry] session=${sessionId} failed`, error);
    }
  }
  return report;
}

async function pastPaymentGrace(sessionId: string): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ past: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM inventory_reservations
       WHERE checkout_session_id = ${sessionId}::uuid
         AND state = 'held'
         AND expires_at <= now() - make_interval(mins => ${PAYMENT_GRACE_MINUTES}::int)
    ) AS past
  `;
  return row?.past ?? false;
}

async function expireSession(sessionId: string, razorpay: RazorpayClient | null): Promise<ExpiryOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { checkoutSessionId: sessionId },
    select: { providerOrderId: true },
  });

  let verifiedOrderId: string | null = null;
  let attemptUnfinished = false;
  if (payment?.providerOrderId) {
    if (!(await pastPaymentGrace(sessionId))) return "kept_in_payment_grace";
    if (!razorpay) return "kept_unverified";
    // Network read outside every transaction (R9). A capture is applied —
    // and the hold committed — right here, through the Phase 7 path.
    const attempts = await razorpay.listOrderPayments(payment.providerOrderId);
    await applyOrderAttempts(payment.providerOrderId, attempts);
    // Only a definite failure is proof that an attempt moved no money.
    attemptUnfinished = attempts.some((attempt) => attempt.status !== "failed");
    verifiedOrderId = payment.providerOrderId;
  }

  return runLockingTransaction("expire", async (tx) => {
    const [lockedPayment] = await tx.$queryRaw<LockedPayment[]>`
      SELECT status, provider_order_id FROM payments
       WHERE checkout_session_id = ${sessionId}::uuid
         FOR UPDATE
    `;
    const [session] = await tx.$queryRaw<{ state: CheckoutState }[]>`
      SELECT state FROM checkout_sessions WHERE id = ${sessionId}::uuid FOR UPDATE
    `;
    if (!session) return "nothing_to_do";

    if (lockedPayment && MONEY_MAY_HAVE_MOVED.has(lockedPayment.status)) {
      return "kept_payment_in_progress";
    }
    // An order created since the unlocked read above was not verified with
    // Razorpay in this pass; keep the hold until a later run checks it.
    if (lockedPayment?.provider_order_id && lockedPayment.provider_order_id !== verifiedOrderId) {
      return "kept_in_payment_grace";
    }
    if (attemptUnfinished) return "kept_attempt_unfinished";

    const [check] = await tx.$queryRaw<{ expired: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM inventory_reservations
         WHERE checkout_session_id = ${sessionId}::uuid AND state = 'held' AND expires_at <= now()
      ) AS expired
    `;
    if (!check?.expired) return "nothing_to_do";

    const released = await releaseHolds(tx, sessionId, ReservationState.expired);
    if (isValidCheckoutTransition(session.state, CheckoutState.expired)) {
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: { state: CheckoutState.expired },
        select: { id: true },
      });
      console.info(`[checkout] session=${sessionId} transition ${session.state} -> expired`);
    } else {
      console.error(
        `[jobs/expiry] session=${sessionId} released ${released} held line(s) from unexpected state "${session.state}"`,
      );
    }
    return released > 0 ? "expired" : "nothing_to_do";
  });
}
