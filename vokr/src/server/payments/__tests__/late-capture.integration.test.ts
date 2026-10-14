import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { CheckoutState, PaymentIssueState, PaymentStatus, ReservationState } from "@/generated/prisma/enums";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
  stockOf,
} from "@/server/inventory/__tests__/checkout-fixtures";
import { expireReservations, PAYMENT_GRACE_MINUTES } from "@/server/jobs/expire-reservations";
import { runMaintenance } from "@/server/jobs/maintenance";

import { MAX_RESOLVE_ATTEMPTS, refundKeyFor, resolvePaymentIssues } from "../late-payment";
import {
  RazorpayApiError,
  type RazorpayClient,
  type RazorpayOrder,
  type RazorpayPayment,
  type RazorpayPaymentDetail,
  type RazorpayRefund,
  type RazorpayRefundClient,
} from "../razorpay";
import { createPaymentOrder } from "../service";
import { handleRazorpayWebhook } from "../webhook";

/**
 * Money that arrives for stock this server no longer holds (plan §5 Phase
 * 8, Open 5), against a real Postgres. Razorpay is an in-memory fake that
 * models what the refund path relies on: `X-Refund-Idempotency` (same key
 * and body → the same refund), a payment can never be refunded beyond its
 * amount, and refunds move `pending → processed | failed`.
 */

const AMOUNT = 999_500;
const WEBHOOK_SECRET = "whsec_late_capture_fixture";
const PAY_ID = "pay_LateCapture0001";

const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  readonly payments = new Map<string, RazorpayPayment[]>();

  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    const order = {
      id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      status: "created",
    };
    this.orders.set(order.id, order);
    return order;
  }

  async findOrderByReceipt(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt) ?? null;
  }

  async listOrderPayments(orderId: string) {
    return this.payments.get(orderId) ?? [];
  }
}

class FakeRefunds implements RazorpayRefundClient {
  readonly payments = new Map<string, RazorpayPaymentDetail>();
  readonly refunds = new Map<string, RazorpayRefund[]>();
  private readonly byKey = new Map<string, { body: string; refund: RazorpayRefund }>();
  createCalls = 0;
  /** Status a new refund is born with. */
  newRefundStatus = "pending";
  /** Razorpay accepts the refund, then the response is lost (timeout, crash). */
  loseNextCreateResponse = false;
  /** Every call fails like this, once each, until the queue is empty. */
  readonly failures: Error[] = [];
  /** Whether the refund list echoes `receipt` (unverified without test keys). */
  echoReceipt = true;

  payment(id: string, status: string, overrides: Partial<RazorpayPaymentDetail> = {}) {
    this.payments.set(id, {
      id,
      order_id: null,
      amount: AMOUNT,
      currency: "INR",
      status,
      amount_refunded: 0,
      refund_status: null,
      ...overrides,
    });
  }

  private maybeFail() {
    const failure = this.failures.shift();
    if (failure) throw failure;
  }

  async fetchPayment(paymentId: string) {
    this.maybeFail();
    const payment = this.payments.get(paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    return { ...payment };
  }

  async listPaymentRefunds(paymentId: string) {
    this.maybeFail();
    return (this.refunds.get(paymentId) ?? []).map((refund) => ({
      ...refund,
      receipt: this.echoReceipt ? refund.receipt : null,
    }));
  }

  async createRefund(input: { paymentId: string; amountPaise: number; receipt: string; idempotencyKey: string }) {
    this.createCalls += 1;
    this.maybeFail();
    const body = JSON.stringify({ amount: input.amountPaise, receipt: input.receipt });
    const previous = this.byKey.get(input.idempotencyKey);
    if (previous) {
      if (previous.body !== body) throw new RazorpayApiError(400, "Different request with the same idempotency key");
      return { ...previous.refund };
    }
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    if (payment.amount_refunded + input.amountPaise > payment.amount) {
      throw new RazorpayApiError(400, "The payment has been fully refunded already");
    }
    const refund: RazorpayRefund = {
      id: `rfnd_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      payment_id: input.paymentId,
      amount: input.amountPaise,
      currency: "INR",
      status: this.newRefundStatus,
      receipt: input.receipt,
    };
    this.byKey.set(input.idempotencyKey, { body, refund });
    this.refunds.set(input.paymentId, [...(this.refunds.get(input.paymentId) ?? []), refund]);
    payment.amount_refunded += input.amountPaise;
    payment.refund_status = payment.amount_refunded === payment.amount ? "full" : "partial";
    if (refund.status === "processed" && payment.refund_status === "full") payment.status = "refunded";
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new Error("socket hang up");
    }
    return { ...refund };
  }

  /** Razorpay finishes a pending refund. */
  settle(paymentId: string, status: "processed" | "failed") {
    for (const refund of this.refunds.get(paymentId) ?? []) refund.status = status;
    const payment = this.payments.get(paymentId);
    if (payment && status === "processed" && payment.refund_status === "full") payment.status = "refunded";
  }
}

async function deliver(
  type: string,
  orderId: string,
  input: { paymentId?: string; amount?: number; status?: string } = {},
) {
  const rawBody = JSON.stringify({
    entity: "event",
    event: type,
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: input.paymentId ?? PAY_ID,
          order_id: orderId,
          amount: input.amount ?? AMOUNT,
          currency: "INR",
          status: input.status ?? type.replace("payment.", ""),
        },
      },
    },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  return handleRazorpayWebhook({
    rawBody,
    signature: createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex"),
    eventId,
    secret: WEBHOOK_SECRET,
  });
}

async function stateOf(sessionId: string) {
  return (await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: { state: true } })).state;
}

async function paymentOf(sessionId: string) {
  return prisma.payment.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: { id: true, status: true },
  });
}

async function issuesOf(sessionId: string) {
  return prisma.paymentIssue.findMany({
    where: { payment: { checkoutSessionId: sessionId } },
    select: {
      state: true,
      reason: true,
      providerPaymentId: true,
      amountPaise: true,
      refundId: true,
      attempts: true,
      lastError: true,
      resolvedAt: true,
    },
    orderBy: { providerPaymentId: "asc" },
  });
}

async function paymentRowOf(sessionId: string) {
  return prisma.payment.findUniqueOrThrow({
    where: { checkoutSessionId: sessionId },
    select: { status: true, providerPaymentId: true },
  });
}

/** A reserved, payment_pending session with one Razorpay order. */
async function payingSession(razorpay: FakeRazorpay, quantityOnHand = 5) {
  const variantId = await stockedVariant(fixtures, quantityOnHand, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, {
    lines: [{ variantId, quantity: 1 }],
    totalPaise: AMOUNT,
  });
  await reserveCheckoutSession(identity, sessionId);
  const order = await createPaymentOrder(identity, sessionId, razorpay);
  return { sessionId, variantId, orderId: order.razorpayOrderId };
}

/** The hold lapses and the expiry job releases it: the session ends `expired`. */
async function releaseByExpiry(sessionId: string, razorpay: FakeRazorpay) {
  await prisma.$executeRaw`
    UPDATE inventory_reservations
       SET expires_at = now() - make_interval(mins => ${PAYMENT_GRACE_MINUTES + 1}::int)
     WHERE checkout_session_id = ${sessionId}::uuid
  `;
  await prisma.$executeRaw`
    UPDATE checkout_sessions
       SET expires_at = now() - make_interval(mins => ${PAYMENT_GRACE_MINUTES + 1}::int)
     WHERE id = ${sessionId}::uuid
  `;
  await expireReservations(razorpay);
  expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
}

/** A session whose hold expired and was released, then captured late: one open issue. */
async function lateCapture() {
  const razorpay = new FakeRazorpay();
  const session = await payingSession(razorpay);
  await releaseByExpiry(session.sessionId, razorpay);
  await deliver("payment.captured", session.orderId);
  return { ...session, razorpay };
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recording a payment for stock that is no longer held", () => {
  it("never marks a payment_pending session paid when it holds no stock", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    // The holds are gone (released by any path) but the session was left
    // payment_pending: the capture must not turn that into a paid order.
    await prisma.$executeRaw`
      UPDATE inventory SET quantity_reserved = quantity_reserved - 1 WHERE variant_id = ${variantId}::uuid
    `;
    await prisma.inventoryReservation.updateMany({
      where: { checkoutSessionId: sessionId },
      data: { state: ReservationState.released },
    });

    const result = await deliver("payment.captured", orderId);

    expect(result.status).toBe(200);
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.captured);
    expect(await issuesOf(sessionId)).toEqual([
      expect.objectContaining({ state: PaymentIssueState.open, reason: "no_held_stock", providerPaymentId: PAY_ID }),
    ]);
  });

  it("a capture after expiry leaves the session expired, stock untouched, and opens one issue", async () => {
    const { sessionId, variantId } = await lateCapture();

    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 5, quantityReserved: 0 });
    expect(await issuesOf(sessionId)).toEqual([
      expect.objectContaining({
        state: PaymentIssueState.open,
        reason: "session_expired",
        amountPaise: AMOUNT,
        refundId: null,
        resolvedAt: null,
      }),
    ]);
  });

  it("an authorization after expiry also opens the issue, before any capture", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);

    await deliver("payment.authorized", orderId);
    await deliver("payment.captured", orderId);

    expect(await issuesOf(sessionId)).toEqual([expect.objectContaining({ state: PaymentIssueState.open })]);
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.captured);
  });

  it("duplicate and concurrent deliveries of the late capture converge on one issue", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);

    await Promise.all(Array.from({ length: 5 }, () => deliver("payment.captured", orderId)));
    await deliver("payment.captured", orderId);

    expect(await issuesOf(sessionId)).toHaveLength(1);
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.captured);
  });

  it("an in-time capture still pays the session and opens no issue", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);

    await deliver("payment.captured", orderId);

    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    expect(await issuesOf(sessionId)).toEqual([]);
  });
});

describe("resolving it: the full refund", () => {
  it("refunds a captured late payment once, with a stable idempotency key, then closes on processed", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");

    const first = await resolvePaymentIssues(refunds);
    expect(first.outcomes.refund_pending).toBe(1);
    const [initiated] = await issuesOf(sessionId);
    expect(initiated).toMatchObject({ state: PaymentIssueState.refund_initiated, attempts: 0 });
    expect(initiated?.refundId).toMatch(/^rfnd_/);
    expect(refunds.refunds.get(PAY_ID)?.[0]?.receipt).toBe(refundKeyFor(PAY_ID));

    // Still pending at Razorpay: the next run adopts, never re-creates.
    await resolvePaymentIssues(refunds);
    expect(refunds.createCalls).toBe(1);

    refunds.settle(PAY_ID, "processed");
    const last = await resolvePaymentIssues(refunds);

    expect(last.outcomes.refunded).toBe(1);
    expect(last.totals.refunded).toBeGreaterThanOrEqual(1);
    const [closed] = await issuesOf(sessionId);
    expect(closed?.state).toBe(PaymentIssueState.refunded);
    expect(closed?.resolvedAt).not.toBeNull();
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.refunded);
    expect(refunds.createCalls).toBe(1);
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
  });

  it("a refund.processed webhook closes the issue too", async () => {
    const { sessionId, orderId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    await resolvePaymentIssues(refunds);

    await deliver("refund.processed", orderId, { status: "refunded" });

    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.refunded);
    await resolvePaymentIssues(refunds);
    expect(refunds.createCalls).toBe(1);
  });

  it("adopts a refund Razorpay accepted when the response was lost, instead of creating a second", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    refunds.loseNextCreateResponse = true;

    const crashed = await resolvePaymentIssues(refunds);
    expect(crashed.errors).toBe(1);
    expect(await issuesOf(sessionId)).toEqual([expect.objectContaining({ state: PaymentIssueState.open, attempts: 1 })]);

    const next = await resolvePaymentIssues(refunds);

    expect(next.outcomes.refund_pending).toBe(1);
    expect(refunds.createCalls).toBe(1);
    expect(refunds.refunds.get(PAY_ID)).toHaveLength(1);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refund_initiated);
  });

  it("two overlapping runs create exactly one refund", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");

    await Promise.all([resolvePaymentIssues(refunds), resolvePaymentIssues(refunds)]);

    expect(refunds.refunds.get(PAY_ID)).toHaveLength(1);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refund_initiated);
  });

  it("a 409 (request still in progress) is retried later without counting as a failure", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    refunds.failures.push(new RazorpayApiError(409, "Another request with the same idempotency key is still in progress"));

    const report = await resolvePaymentIssues(refunds);

    expect(report.outcomes.retry_later).toBe(1);
    expect(report.errors).toBe(0);
    expect(await issuesOf(sessionId)).toEqual([expect.objectContaining({ state: PaymentIssueState.open, attempts: 0 })]);
  });

  it("an already fully refunded payment is closed without another refund", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "refunded", { amount_refunded: AMOUNT, refund_status: "full" });

    const report = await resolvePaymentIssues(refunds);

    expect(report.outcomes.refunded).toBe(1);
    expect(refunds.createCalls).toBe(0);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
  });
});

describe("resolving it: what the job will not decide alone", () => {
  it("waits on an authorized-but-not-captured payment and refunds only once it is captured", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);
    await deliver("payment.authorized", orderId);
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "authorized");

    const waiting = await resolvePaymentIssues(refunds);
    expect(waiting.outcomes.awaiting_capture).toBe(1);
    expect(refunds.createCalls).toBe(0);

    refunds.payment(PAY_ID, "captured");
    const refunded = await resolvePaymentIssues(refunds);
    expect(refunded.outcomes.refund_pending).toBe(1);
    expect(refunds.createCalls).toBe(1);
  });

  it("closes an authorization Razorpay auto-refunded without ever capturing it", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);
    await deliver("payment.authorized", orderId);
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "refunded", { amount_refunded: AMOUNT, refund_status: "full" });

    await resolvePaymentIssues(refunds);

    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.authorized);
    expect(refunds.createCalls).toBe(0);
  });

  it.each([
    ["a partial refund made outside the job", (r: FakeRefunds) => r.payment(PAY_ID, "captured", { amount_refunded: 100, refund_status: "partial" })],
    ["a partial refund the job did not make", (r: FakeRefunds) => {
      r.payment(PAY_ID, "captured", { amount_refunded: 100, refund_status: "partial" });
      r.refunds.set(PAY_ID, [{ id: "rfnd_dashboard", payment_id: PAY_ID, amount: 100, currency: "INR", status: "pending", receipt: null }]);
    }],
    ["a status this code does not know", (r: FakeRefunds) => r.payment(PAY_ID, "disputed")],
    ["an amount that does not match the issue", (r: FakeRefunds) => r.payment(PAY_ID, "captured", { amount: AMOUNT + 1 })],
  ])("sends %s to manual review and refunds nothing", async (_label, arrange) => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    arrange(refunds);

    const report = await resolvePaymentIssues(refunds);

    expect(report.outcomes.manual_review).toBe(1);
    expect(refunds.createCalls).toBe(0);
    const [issue] = await issuesOf(sessionId);
    expect(issue?.state).toBe(PaymentIssueState.manual_review);
    expect(issue?.lastError).toBeTruthy();
    expect(issue?.resolvedAt).toBeNull();

    // Terminal for the job: a later run does not touch it.
    await resolvePaymentIssues(refunds);
    expect(refunds.createCalls).toBe(0);
  });

  it("a refund Razorpay fails goes to manual review", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    await resolvePaymentIssues(refunds);

    refunds.settle(PAY_ID, "failed");
    const report = await resolvePaymentIssues(refunds);

    expect(report.outcomes.manual_review).toBe(1);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.manual_review);
    expect(refunds.createCalls).toBe(1);
  });

  it(`gives up after ${MAX_RESOLVE_ATTEMPTS} consecutive API failures and asks for a human`, async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    for (let i = 0; i < MAX_RESOLVE_ATTEMPTS; i += 1) refunds.failures.push(new RazorpayApiError(502, "Bad gateway"));

    for (let i = 0; i < MAX_RESOLVE_ATTEMPTS; i += 1) await resolvePaymentIssues(refunds);

    const [issue] = await issuesOf(sessionId);
    expect(issue?.state).toBe(PaymentIssueState.manual_review);
    expect(issue?.lastError).toMatch(/5 failed attempts/);
    expect(refunds.createCalls).toBe(0);
  });
});

describe("in the maintenance job", () => {
  it("without Razorpay credentials the issue stays open, durably, and nothing is refunded", async () => {
    const { sessionId } = await lateCapture();

    const report = await runMaintenance(null, null);

    expect(report.latePayments).toEqual({ status: "not_configured" });
    expect(report.ok).toBe(true);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.open);
  });

  it("refunds a late capture and reports counts only", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    refunds.newRefundStatus = "processed";

    const report = await runMaintenance(null, refunds);

    expect(report.ok).toBe(true);
    expect(report.latePayments.status).toBe("ok");
    if (report.latePayments.status !== "ok") return;
    expect(report.latePayments.result.outcomes.refunded).toBe(1);
    expect(JSON.stringify(report)).not.toContain(PAY_ID);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
  });
});

describe("refundKeyFor", () => {
  it("is stable for a payment and satisfies Razorpay's idempotency-key format", () => {
    const key = refundKeyFor("pay_FgR9UMzgmKDJRi");
    expect(key).toBe("vokr_late_pay_FgR9UMzgmKDJRi");
    expect(key).toMatch(/^[A-Za-z0-9_-]{10,40}$/);
  });

  it("refuses an id that would make an invalid key rather than sending one", () => {
    expect(() => refundKeyFor("pay with spaces")).toThrow();
    expect(() => refundKeyFor("x".repeat(40))).toThrow();
  });
});

describe("a second payment on the same Razorpay order", () => {
  const SECOND = "pay_LateCapture0002";

  it("on an order already paid: the order stays paid on the first payment, the second opens an issue", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, variantId, orderId } = await payingSession(razorpay);
    await deliver("payment.captured", orderId);
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);

    const result = await deliver("payment.captured", orderId, { paymentId: SECOND });

    expect(result.status).toBe(200);
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect(await paymentRowOf(sessionId)).toEqual({ status: PaymentStatus.captured, providerPaymentId: PAY_ID });
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 4, quantityReserved: 0 });
    expect(await issuesOf(sessionId)).toEqual([
      expect.objectContaining({ providerPaymentId: SECOND, state: PaymentIssueState.open, reason: "additional_payment" }),
    ]);
  });

  it("on an expired order: each payment opens its own issue and each is refunded once", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);
    await deliver("payment.captured", orderId);
    await deliver("payment.captured", orderId, { paymentId: SECOND });
    await deliver("payment.captured", orderId, { paymentId: SECOND });

    expect((await issuesOf(sessionId)).map((issue) => issue.providerPaymentId)).toEqual([PAY_ID, SECOND]);

    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    refunds.payment(SECOND, "captured");
    refunds.newRefundStatus = "processed";
    await resolvePaymentIssues(refunds);

    expect((await issuesOf(sessionId)).map((issue) => issue.state)).toEqual([
      PaymentIssueState.refunded,
      PaymentIssueState.refunded,
    ]);
    expect(refunds.createCalls).toBe(2);
  });

  it("refunding the second payment never marks the paid order refunded", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await deliver("payment.captured", orderId);
    await deliver("payment.captured", orderId, { paymentId: SECOND });

    const refunds = new FakeRefunds();
    refunds.payment(SECOND, "captured");
    refunds.newRefundStatus = "processed";
    await resolvePaymentIssues(refunds);
    await deliver("refund.processed", orderId, { paymentId: SECOND, status: "refunded" });

    expect(await paymentRowOf(sessionId)).toEqual({ status: PaymentStatus.captured, providerPaymentId: PAY_ID });
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
  });
});

describe("closing without guesswork", () => {
  it("adopts its own refund by id when Razorpay's list does not echo the receipt", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured");
    await resolvePaymentIssues(refunds);
    refunds.echoReceipt = false;

    const report = await resolvePaymentIssues(refunds);

    expect(report.outcomes.refund_pending).toBe(1);
    expect(refunds.createCalls).toBe(1);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refund_initiated);
  });

  it("waits on a full refund Razorpay made itself, and closes once it is processed", async () => {
    const { sessionId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "refunded", { amount_refunded: AMOUNT, refund_status: "full" });
    refunds.refunds.set(PAY_ID, [
      { id: "rfnd_auto", payment_id: PAY_ID, amount: AMOUNT, currency: "INR", status: "pending", receipt: null },
    ]);

    const waiting = await resolvePaymentIssues(refunds);
    expect(waiting.outcomes.refund_pending).toBe(1);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.open);

    refunds.settle(PAY_ID, "processed");
    await resolvePaymentIssues(refunds);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
    expect(refunds.createCalls).toBe(0);
  });

  it("a manual-review issue closes once a full refund made by a person is processed", async () => {
    const { sessionId, orderId } = await lateCapture();
    const refunds = new FakeRefunds();
    refunds.payment(PAY_ID, "captured", { amount_refunded: 100, refund_status: "partial" });
    await resolvePaymentIssues(refunds);
    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.manual_review);

    // The person refunds the rest in the dashboard; Razorpay reports it.
    refunds.payment(PAY_ID, "refunded", { amount_refunded: AMOUNT, refund_status: "full" });
    refunds.refunds.set(PAY_ID, [
      { id: "rfnd_a", payment_id: PAY_ID, amount: 100, currency: "INR", status: "processed", receipt: null },
      { id: "rfnd_b", payment_id: PAY_ID, amount: AMOUNT - 100, currency: "INR", status: "processed", receipt: null },
    ]);
    await resolvePaymentIssues(refunds);

    expect((await issuesOf(sessionId))[0]?.state).toBe(PaymentIssueState.refunded);
    expect(refunds.createCalls).toBe(0);
    await deliver("refund.processed", orderId, { status: "refunded" });
    expect((await paymentOf(sessionId)).status).toBe(PaymentStatus.refunded);
  });
});

describe("a late payment whose webhook never arrives", () => {
  it("is found by the maintenance job re-reading recently closed orders", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await releaseByExpiry(sessionId, razorpay);
    razorpay.payments.set(orderId, [
      { id: PAY_ID, order_id: orderId, amount: AMOUNT, currency: "INR", status: "captured" } as RazorpayPayment,
    ]);

    const report = await runMaintenance(razorpay, null);

    expect(report.ok).toBe(true);
    expect(await issuesOf(sessionId)).toEqual([
      expect.objectContaining({ providerPaymentId: PAY_ID, reason: "session_expired" }),
    ]);
    expect(await stateOf(sessionId)).toBe(CheckoutState.expired);
  });

  it("finds a second capture on a paid order too, and re-reads each order at most every 30 minutes", async () => {
    const razorpay = new FakeRazorpay();
    const { sessionId, orderId } = await payingSession(razorpay);
    await deliver("payment.captured", orderId);
    razorpay.payments.set(orderId, [
      { id: PAY_ID, order_id: orderId, amount: AMOUNT, currency: "INR", status: "captured" } as RazorpayPayment,
      { id: "pay_LateCapture0002", order_id: orderId, amount: AMOUNT, currency: "INR", status: "captured" } as RazorpayPayment,
    ]);
    let reads = 0;
    const list = razorpay.listOrderPayments.bind(razorpay);
    razorpay.listOrderPayments = async (id: string) => {
      if (id === orderId) reads += 1;
      return list(id);
    };

    await runMaintenance(razorpay, null);
    await runMaintenance(razorpay, null);

    expect(reads).toBe(1);
    expect(await issuesOf(sessionId)).toEqual([
      expect.objectContaining({ providerPaymentId: "pay_LateCapture0002", reason: "additional_payment" }),
    ]);
    expect(await stateOf(sessionId)).toBe(CheckoutState.paid);
  });
});
