import { PaymentIssueState, PaymentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { applyPaymentObservation } from "./apply";
import {
  closeIssueAsRefunded,
  LIVE_ISSUE_STATES as LIVE_STATES,
  markRefundInitiated,
  moveIssueToManualReview,
  recordIssueAttempt,
} from "./payment-issues";
import { RazorpayApiError, type RazorpayRefund, type RazorpayRefundClient } from "./razorpay";

/**
 * Money that arrived for stock this server no longer holds (plan §5 Phase 8,
 * Open 5). A Razorpay Checkout modal opened before a hold lapsed stays
 * usable, and a late UPI or bank confirmation can authorize up to 3 days
 * later; either can produce a capture for a session that already expired.
 *
 * {@link applyPaymentObservation} opens one `payment_issues` row for it, in
 * the same transaction as the payment's transition. The maintenance job
 * then calls {@link resolvePaymentIssues}, which refunds it in full —
 * only once a fresh Razorpay read says the payment is `captured` with
 * nothing refunded, and never twice:
 *
 * 1. Every refund carries the same `X-Refund-Idempotency` key and receipt,
 *    both derived only from the Razorpay payment id, and an identical body.
 * 2. Before creating a refund, the job lists the payment's refunds and
 *    adopts its own (a crash after Razorpay accepted it but before the
 *    database write is picked up here).
 * 3. Razorpay itself refuses to refund more than was captured.
 *
 * Anything the job should not decide alone — a partial or foreign refund,
 * an unexpected status, an amount that does not match, a failed refund, or
 * {@link MAX_RESOLVE_ATTEMPTS} API errors in a row — goes to
 * `manual_review`, logged at error level with the tag `LATE_PAYMENT`.
 *
 * No network call runs inside a transaction; every local change is a
 * conditional update on the issue's current state, so overlapping or
 * repeated runs converge.
 */

export const MAX_RESOLVE_ATTEMPTS = 5;
const BATCH_SIZE = 50;

/** `X-Refund-Idempotency` and refund `receipt`: ≥ 10 chars of `[A-Za-z0-9_-]`, stable for the payment. */
export function refundKeyFor(providerPaymentId: string): string {
  const key = `vokr_late_${providerPaymentId}`;
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(key)) throw new Error(`cannot derive a refund key from ${providerPaymentId}`);
  return key;
}

export type IssueOutcome =
  | "refunded"
  | "refund_pending"
  | "awaiting_capture"
  | "manual_review"
  | "retry_later";

export interface PaymentIssueReport {
  examined: number;
  outcomes: Record<IssueOutcome, number>;
  errors: number;
  /**
   * Failures while only watching a `manual_review` issue. Logged, never
   * part of `errors`: a person owns that issue, and one Razorpay can't read
   * must not turn every maintenance run into a 500 and bury real failures.
   */
  watchErrors: number;
  /** Every issue by state after this run — `open` + `manual_review` is what a human watches. */
  totals: Record<PaymentIssueState, number>;
}

interface LiveIssue {
  id: string;
  paymentId: string;
  state: PaymentIssueState;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
  refundId: string | null;
  attempts: number;
}

export async function resolvePaymentIssues(razorpay: RazorpayRefundClient): Promise<PaymentIssueReport> {
  const issues = await prisma.paymentIssue.findMany({
    // `manual_review` issues are only watched, for a refund a person made.
    where: { state: { in: [...LIVE_STATES, PaymentIssueState.manual_review] } },
    select: {
      id: true,
      paymentId: true,
      state: true,
      providerPaymentId: true,
      amountPaise: true,
      currency: true,
      refundId: true,
      attempts: true,
    },
    // Enum order: open and refund_initiated first, watched manual_review last.
    orderBy: [{ state: "asc" }, { createdAt: "asc" }],
    take: BATCH_SIZE,
  });

  const outcomes: Record<IssueOutcome, number> = {
    refunded: 0,
    refund_pending: 0,
    awaiting_capture: 0,
    manual_review: 0,
    retry_later: 0,
  };
  let errors = 0;
  let watchErrors = 0;
  for (const issue of issues) {
    try {
      const outcome = await resolveIssue(razorpay, issue);
      outcomes[outcome] += 1;
      console.info(`[payments/late] issue=${issue.id} payment=${issue.paymentId} outcome=${outcome}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (issue.state === PaymentIssueState.manual_review) {
        watchErrors += 1;
        console.warn(`[payments/late] issue=${issue.id} payment=${issue.paymentId} watch failed: ${message}`);
        continue;
      }
      errors += 1;
      console.error(`[payments/late] issue=${issue.id} payment=${issue.paymentId} failed: ${message}`);
      await recordFailure(issue, message);
    }
  }

  const grouped = await prisma.paymentIssue.groupBy({ by: ["state"], _count: { _all: true } });
  const totals: Record<PaymentIssueState, number> = { open: 0, refund_initiated: 0, refunded: 0, manual_review: 0 };
  for (const row of grouped) totals[row.state] = row._count._all;

  return { examined: issues.length, outcomes, errors, watchErrors, totals };
}

async function resolveIssue(razorpay: RazorpayRefundClient, issue: LiveIssue): Promise<IssueOutcome> {
  const key = refundKeyFor(issue.providerPaymentId);
  const watchingOnly = issue.state === PaymentIssueState.manual_review;

  let remote;
  let refunds: RazorpayRefund[];
  try {
    remote = await razorpay.fetchPayment(issue.providerPaymentId);
    refunds =
      remote.status === "captured" || remote.status === "refunded"
        ? await razorpay.listPaymentRefunds(issue.providerPaymentId)
        : [];
  } catch (error) {
    return transient(error);
  }

  // The refunds themselves decide, never the payment's summary fields: a
  // refund still `pending` already counts in `amount_refunded`, and the
  // status reads `refunded` for it too. Whoever made them — this job,
  // Razorpay's auto-refund, a person in the dashboard — only processed
  // refund entities covering the amount close the issue.
  const processed = sum(refunds.filter((refund) => refund.status === "processed"));
  if (processed >= issue.amountPaise) {
    await markRefunded(issue);
    return "refunded";
  }
  // A person owns a manual-review issue; the job only watches for that refund.
  if (watchingOnly) return "manual_review";

  // Razorpay says `refunded` but shows no refund entity (e.g. an
  // authorization released without capture, if Razorpay lists nothing for
  // it). That is not proof the money went back: a person confirms it. The
  // issue stays watched and closes on its own if a processed refund appears.
  if (remote.status === "refunded" && refunds.length === 0) {
    return toManualReview(issue, "Razorpay reports the payment refunded but lists no refund for it");
  }

  if (remote.amount !== issue.amountPaise || remote.currency !== issue.currency) {
    return toManualReview(
      issue,
      `Razorpay reports ${remote.amount} ${remote.currency}, issue is for ${issue.amountPaise} ${issue.currency}`,
    );
  }
  // Late authorizations are captured by Razorpay's auto-capture, or
  // auto-refunded when they are not; either way a later run sees it.
  if (remote.status === "authorized") return "awaiting_capture";
  if (remote.status !== "captured" && remote.status !== "refunded") {
    return toManualReview(issue, `unexpected Razorpay payment status "${remote.status}"`);
  }

  // Ours by receipt, or by the id recorded when Razorpay accepted it
  // (in case the list does not echo the receipt).
  const isOurs = (refund: RazorpayRefund) => refund.receipt === key || refund.id === issue.refundId;
  const ours = refunds.filter(isOurs);
  const foreign = refunds.filter((refund) => !isOurs(refund));
  if (ours.length > 1) return toManualReview(issue, `${ours.length} refunds carry this job's receipt`);
  if (refunds.some((refund) => refund.status === "failed")) {
    const failed = refunds.find((refund) => refund.status === "failed");
    return toManualReview(issue, `refund ${failed?.id} failed`);
  }
  if (foreign.length > 0) {
    // A full refund someone else started (Razorpay's auto-refund, the
    // dashboard) is waited on, never duplicated; anything less is a person's call.
    if (sum(refunds) >= issue.amountPaise) return "refund_pending";
    return toManualReview(issue, `${foreign.length} refund(s) not made by this job cover only ${sum(refunds)}`);
  }

  let refund = ours[0];
  if (!refund && issue.refundId) {
    return toManualReview(issue, `refund ${issue.refundId} was recorded but Razorpay does not list it`);
  }
  if (!refund) {
    if (remote.amount_refunded > 0) {
      return toManualReview(issue, `partially refunded (${remote.amount_refunded}) outside this job`);
    }
    try {
      refund = await razorpay.createRefund({
        paymentId: issue.providerPaymentId,
        amountPaise: issue.amountPaise,
        receipt: key,
        idempotencyKey: key,
      });
    } catch (error) {
      return transient(error);
    }
    console.error(
      `[payments] LATE_PAYMENT refund created payment=${issue.paymentId} razorpay_payment=${issue.providerPaymentId} refund=${refund.id} amount=${refund.amount}`,
    );
  }
  if (refund.amount !== issue.amountPaise) {
    return toManualReview(issue, `refund ${refund.id} is for ${refund.amount}, expected ${issue.amountPaise}`);
  }

  await markRefundInitiated(prisma, issue.id, refund.id);

  if (refund.status === "processed") {
    await markRefunded(issue);
    return "refunded";
  }
  if (refund.status === "failed") return toManualReview(issue, `refund ${refund.id} failed`);
  return "refund_pending";
}

function sum(refunds: readonly RazorpayRefund[]): number {
  return refunds.reduce((total, refund) => total + refund.amount, 0);
}

/** A Razorpay 409 ("still in progress") is not a failure: the next run looks again. Anything else is. */
function transient(error: unknown): IssueOutcome {
  if (error instanceof RazorpayApiError && error.status === 409) return "retry_later";
  throw error;
}

/** Records a full refund through the Phase 7 path (payment → `refunded`) and closes the issue, in one transaction. */
async function markRefunded(issue: LiveIssue): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: issue.paymentId },
      select: { providerOrderId: true, providerPaymentId: true, status: true },
    });
    // Only the order's own payment moves the order's row; refunding a
    // second payment on a paid order leaves the order paid.
    if (
      payment.providerOrderId &&
      payment.status === PaymentStatus.captured &&
      payment.providerPaymentId === issue.providerPaymentId
    ) {
      await applyPaymentObservation(tx, {
        providerOrderId: payment.providerOrderId,
        providerPaymentId: issue.providerPaymentId,
        status: PaymentStatus.refunded,
        amountPaise: issue.amountPaise,
        currency: issue.currency,
      });
    }
    // An `authorized` payment Razorpay refunded without capturing cannot
    // move to `refunded` locally; the issue still closes.
    await closeIssueAsRefunded(tx, issue.providerPaymentId);
  });
}

async function toManualReview(issue: LiveIssue, reason: string): Promise<IssueOutcome> {
  if (await moveIssueToManualReview(prisma, issue.id, reason)) {
    console.error(
      `[payments] LATE_PAYMENT manual_review payment=${issue.paymentId} razorpay_payment=${issue.providerPaymentId} reason=${reason}`,
    );
  }
  return "manual_review";
}

async function recordFailure(issue: LiveIssue, message: string): Promise<void> {
  const attempts = issue.attempts + 1;
  if (attempts >= MAX_RESOLVE_ATTEMPTS) {
    await toManualReview(issue, `${attempts} failed attempts; last: ${message}`);
    return;
  }
  await recordIssueAttempt(prisma, { id: issue.id, state: issue.state, attempts: issue.attempts }, message);
}
