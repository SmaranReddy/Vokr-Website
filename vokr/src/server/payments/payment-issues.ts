import { PaymentIssueState } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Every write to `payment_issues`, kept apart from the maintenance job's
 * resolver (`late-payment.ts`) so the apply path never imports anything
 * that talks to Razorpay. Each update is conditional on the issue's
 * current state, so a repeated or overlapping run changes nothing twice;
 * `updateMany` returns a count only, never row data.
 */

export const LIVE_ISSUE_STATES = [PaymentIssueState.open, PaymentIssueState.refund_initiated];

/** Opens the issue for a payment; a second call for the same payment changes nothing. */
export async function recordPaymentIssue(
  tx: Prisma.TransactionClient,
  input: { paymentId: string; providerPaymentId: string; amountPaise: number; currency: string; reason: string },
): Promise<void> {
  const created = await tx.paymentIssue.createMany({ data: [input], skipDuplicates: true });
  if (created.count === 1) {
    console.error(
      `[payments] LATE_PAYMENT opened payment=${input.paymentId} razorpay_payment=${input.providerPaymentId} amount=${input.amountPaise} reason=${input.reason}`,
    );
  }
}

/** A full refund was observed (webhook or API read): the issue is resolved. */
export async function closeIssueAsRefunded(tx: Prisma.TransactionClient, paymentId: string): Promise<void> {
  const closed = await tx.paymentIssue.updateMany({
    where: { paymentId, state: { in: LIVE_ISSUE_STATES } },
    data: { state: PaymentIssueState.refunded, resolvedAt: new Date() },
  });
  if (closed.count === 1) console.info(`[payments] LATE_PAYMENT refunded payment=${paymentId}`);
}

/** Razorpay accepted the refund: remember it, so later runs adopt it rather than create another. */
export async function markRefundInitiated(
  tx: Prisma.TransactionClient,
  issueId: string,
  refundId: string,
): Promise<void> {
  await tx.paymentIssue.updateMany({
    where: { id: issueId, state: PaymentIssueState.open },
    data: { state: PaymentIssueState.refund_initiated, refundId, attempts: 0, lastError: null },
  });
}

/** Hands a live issue to a human. `true` when this call moved it. */
export async function moveIssueToManualReview(
  tx: Prisma.TransactionClient,
  issueId: string,
  reason: string,
): Promise<boolean> {
  const moved = await tx.paymentIssue.updateMany({
    where: { id: issueId, state: { in: LIVE_ISSUE_STATES } },
    data: { state: PaymentIssueState.manual_review, lastError: reason.slice(0, 500) },
  });
  return moved.count === 1;
}

/** Counts one failed attempt, unless another run already moved the issue on. */
export async function recordIssueAttempt(
  tx: Prisma.TransactionClient,
  seen: { id: string; state: PaymentIssueState; attempts: number },
  message: string,
): Promise<void> {
  await tx.paymentIssue.updateMany({
    where: { id: seen.id, state: seen.state, attempts: seen.attempts },
    data: { attempts: seen.attempts + 1, lastError: message.slice(0, 500) },
  });
}
