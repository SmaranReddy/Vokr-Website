import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { EmailStatus } from "@/generated/prisma/enums";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import { runMaintenance } from "@/server/jobs/maintenance";
import type { RazorpayClient, RazorpayOrder } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { EmailSendError, type OutgoingEmail, type TransactionalEmailClient } from "../brevo";
import { DAILY_LIMIT, MAX_ATTEMPTS, recipientHash, RESEND_WINDOW_MS, sendPendingEmails, STALE_SENDING_MS } from "../outbox";

/**
 * The email outbox (plan §5 Phase 11) against a real Postgres, with real
 * orders made by a verified capture. The fixtures' contact email is
 * `buyer@example.com`. Brevo is a fake that records what it was asked to send.
 */

const SECRET = "whsec_email_fixture";
const AMOUNT = 999_500;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    const order = { id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`, amount: input.amountPaise, currency: "INR", receipt: input.receipt, status: "created" };
    this.orders.set(order.id, order);
    return order;
  }
  async findOrderByReceipt(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt) ?? null;
  }
  async listOrderPayments() {
    return [];
  }
}

class FakeBrevo implements TransactionalEmailClient {
  readonly sent: OutgoingEmail[] = [];
  readonly keys: string[] = [];
  failures: EmailSendError[] = [];
  delayMs = 0;
  onSend: (() => void) | null = null;
  async send(email: OutgoingEmail) {
    this.keys.push(email.idempotencyKey);
    this.onSend?.();
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(email);
    return { messageId: `<m${this.sent.length}@test>` };
  }
}

async function deliver(rawBody: string) {
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
}

/** A real paid order; returns its id and the capture body (for replays). */
async function paidOrder(): Promise<{ orderId: string; capture: string }> {
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, new FakeRazorpay());
  const capture = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  await deliver(capture);
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { id: true } });
  return { orderId: order.id, capture };
}

function rowsFor(orderId: string) {
  return prisma.emailLog.findMany({
    where: { orderId },
    select: { status: true, template: true, attempts: true, recipientHash: true, providerMessageId: true, lastError: true },
  });
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the outbox row is written with the order", () => {
  it("exactly one pending confirmation per order, even when the capture is replayed", async () => {
    const { orderId, capture } = await paidOrder();
    await deliver(capture);
    await deliver(capture);
    expect(await rowsFor(orderId)).toEqual([
      { status: "pending", template: "order_confirmation", attempts: 0, recipientHash: null, providerMessageId: null, lastError: null },
    ]);
  });
});

describe("sending", () => {
  it("sends the confirmation once, to the order's contact email, and keeps only a hash of it", async () => {
    const { orderId } = await paidOrder();
    const brevo = new FakeBrevo();

    const report = await sendPendingEmails(brevo);

    expect(report.sent).toBeGreaterThanOrEqual(1);
    const mine = brevo.sent.filter((email) => email.subject.startsWith("Your Vokr order VK-"));
    expect(mine.map((email) => email.to)).toContain("buyer@example.com");
    const [row] = await rowsFor(orderId);
    expect(row).toMatchObject({ status: "sent", attempts: 1, recipientHash: recipientHash("buyer@example.com") });
    expect(row?.providerMessageId).toMatch(/^<m\d+@test>$/);
    const stored = JSON.stringify(await prisma.emailLog.findFirstOrThrow({ where: { orderId } }));
    expect(stored).not.toContain("buyer@example.com");

    await sendPendingEmails(brevo);
    expect(brevo.sent.filter((email) => email.to === "buyer@example.com")).toHaveLength(mine.length);
  });

  it("two overlapping runs send it once", async () => {
    const { orderId } = await paidOrder();
    const brevo = new FakeBrevo();
    brevo.delayMs = 50;

    await Promise.all([sendPendingEmails(brevo), sendPendingEmails(brevo)]);

    const sentForOrder = await prisma.emailLog.count({ where: { orderId, status: EmailStatus.sent } });
    expect(sentForOrder).toBe(1);
    expect(brevo.sent).toHaveLength(1);
  });

  it("a retryable failure goes back to pending; it fails for good after the attempt limit", async () => {
    const { orderId } = await paidOrder();
    const brevo = new FakeBrevo();
    brevo.failures = Array.from({ length: MAX_ATTEMPTS }, () => new EmailSendError("Brevo 503", true));

    await sendPendingEmails(brevo);
    expect((await rowsFor(orderId))[0]).toMatchObject({ status: "pending", attempts: 1, lastError: "Brevo 503" });

    for (let i = 1; i < MAX_ATTEMPTS; i += 1) await sendPendingEmails(brevo);
    expect((await rowsFor(orderId))[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(brevo.sent).toHaveLength(0);
  });

  it("a permanent failure (bad key, unverified sender) fails at once", async () => {
    const { orderId } = await paidOrder();
    const brevo = new FakeBrevo();
    brevo.failures = [new EmailSendError("Brevo 401: unauthorized", false)];

    await sendPendingEmails(brevo);

    expect((await rowsFor(orderId))[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("an abandoned send is re-queued inside Brevo's dedup window (same key), and failed for a person after it", async () => {
    const recent = await paidOrder();
    const old = await paidOrder();
    await prisma.$executeRaw`
      UPDATE email_log SET status = 'sending', updated_at = now() - make_interval(secs => ${STALE_SENDING_MS / 1000 + 60})
       WHERE order_id = ${recent.orderId}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE email_log SET status = 'sending', updated_at = now() - make_interval(secs => ${RESEND_WINDOW_MS / 1000 + 60})
       WHERE order_id = ${old.orderId}::uuid
    `;
    const brevo = new FakeBrevo();

    const report = await sendPendingEmails(brevo);

    expect(report.staleSendingRequeued).toBeGreaterThanOrEqual(1);
    expect(report.staleSendingFailed).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(recent.orderId))[0]?.status).toBe("sent");
    expect((await rowsFor(old.orderId))[0]?.status).toBe("failed");
    const recentRow = await prisma.emailLog.findFirstOrThrow({ where: { orderId: recent.orderId }, select: { id: true } });
    expect(brevo.keys).toContain(recentRow.id);
  });

  it("a bad key or unverified sender pauses the queue without spending any email's attempts", async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    const brevo = new FakeBrevo();
    brevo.failures = [new EmailSendError("Brevo 401: unauthorized", false, "account")];

    const report = await sendPendingEmails(brevo);

    expect(report.accountBlocked).toBe(true);
    const rows = [...(await rowsFor(first.orderId)), ...(await rowsFor(second.orderId))];
    expect(rows.map((row) => row.status)).toEqual(["pending", "pending"]);
    expect(rows.map((row) => row.attempts)).toEqual([0, 0]);
    expect(brevo.sent).toHaveLength(0);
  });

  it("stops claiming when its time budget is spent; the rest stay pending, attempts untouched", async () => {
    const first = await paidOrder();
    const second = await paidOrder();
    let now = 0;
    const brevo = new FakeBrevo();
    brevo.onSend = () => {
      now += 20_000; // each send "takes" 20 s
    };

    const report = await sendPendingEmails(brevo, new Date(), { budgetMs: 15_000, clock: () => now });

    expect(report.budgetExhausted).toBe(true);
    const statuses = [(await rowsFor(first.orderId))[0], (await rowsFor(second.orderId))[0]];
    expect(statuses.filter((row) => row?.status === "sent")).toHaveLength(report.sent);
    expect(statuses.filter((row) => row?.status === "pending" && row.attempts === 0).length).toBeGreaterThanOrEqual(1);
  });

  it(`stops for the day at ${DAILY_LIMIT} sends; the rest wait`, async () => {
    const { orderId } = await paidOrder();
    // Stand-in rows for today's earlier sends.
    await prisma.$executeRaw`
      INSERT INTO email_log (id, order_id, template, status, recipient_hash, provider_message_id, attempts, created_at, updated_at, sent_at)
      SELECT gen_random_uuid(), NULL, 'order_confirmation', 'sent', repeat('a', 64), 'm', 1, now(), now(), now()
        FROM generate_series(1, ${DAILY_LIMIT})
    `;
    try {
      const brevo = new FakeBrevo();
      const report = await sendPendingEmails(brevo);
      expect(report.dailyLimitReached).toBe(true);
      expect(brevo.sent).toHaveLength(0);
      expect((await rowsFor(orderId))[0]?.status).toBe("pending");
    } finally {
      await prisma.emailLog.deleteMany({ where: { orderId: null } });
    }
  });
});

describe("in the maintenance job", () => {
  it("without a Brevo key the outbox is not_configured and the email waits, pending", async () => {
    const { orderId } = await paidOrder();
    const report = await runMaintenance(null, null, null);
    expect(report.emails).toEqual({ status: "not_configured" });
    expect((await rowsFor(orderId))[0]?.status).toBe("pending");
  });

  it("with a client, the run sends it and reports counts only", async () => {
    const { orderId } = await paidOrder();
    const brevo = new FakeBrevo();
    const report = await runMaintenance(null, null, brevo);
    expect(report.emails).toMatchObject({ status: "ok", result: { failed: 0 } });
    expect(JSON.stringify(report)).not.toContain("buyer@example.com");
    expect((await rowsFor(orderId))[0]?.status).toBe("sent");
  });
});
