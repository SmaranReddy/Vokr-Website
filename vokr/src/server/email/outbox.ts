import { createHash } from "node:crypto";

import { EmailStatus, EmailTemplate } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { siteConfig } from "@/config/site";
import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";

import { EmailSendError, type OutgoingEmail, type TransactionalEmailClient } from "./brevo";
import { renderOrderConfirmation } from "./templates/order-confirmation";
import { renderOrderShipped } from "./templates/order-shipped";

/**
 * The email outbox (plan §5 Phase 11, tasks 4–6, 8). Rows are written
 * `pending` in the same transaction as the event (`enqueueOrderConfirmation`
 * inside order creation) and sent here, by the maintenance job, after that
 * transaction has committed — so an email can never fail, slow or roll back
 * a payment.
 *
 * - **One email per order event:** `UNIQUE(order_id, template)`.
 * - **No double send:** a row is claimed `pending → sending` by a
 *   conditional update, so overlapping runs cannot both send it, and every
 *   send carries the row id as Brevo's idempotency key, so a retry after a
 *   timeout cannot duplicate it either. A row left `sending` by a crash is
 *   re-queued while it is still inside Brevo's deduplication window
 *   ({@link RESEND_WINDOW_MS}); after that a resend could duplicate, so it
 *   goes to `failed` for a person.
 * - **Bounded run:** the step stops claiming after {@link STEP_BUDGET_MS}
 *   (Scheduler's deadline is 90 s); unclaimed rows wait, still `pending`.
 * - **Account problems stop the batch:** a bad key or unverified sender
 *   (401/403) puts the row back to `pending` without spending an attempt
 *   and stops — instead of failing every confirmation in the queue.
 * - **Bounded retry:** a retryable failure goes back to `pending` (up to
 *   {@link MAX_ATTEMPTS}); anything else, or the last attempt, is `failed`
 *   and logged under {@link EMAIL_FAILED_TAG}.
 * - **Daily volume:** a warning at {@link DAILY_WARNING} sends (the PDF's
 *   200/day guardrail against Brevo's free 300/day); sending stops for the
 *   day at {@link DAILY_LIMIT} so transactional mail is never cut off
 *   mid-flow by the provider.
 * - **No PII stored:** the address is decrypted only to send; the row keeps
 *   a SHA-256 of it. The rendered body is never stored.
 */

export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 20;
export const DAILY_WARNING = 200;
export const DAILY_LIMIT = 290;
/** A `sending` row older than this was abandoned (a send takes at most a few seconds). */
export const STALE_SENDING_MS = 3 * 60 * 1000;
/** Inside Brevo's idempotency window (15 min, conservatively): a re-queued send is deduplicated. */
export const RESEND_WINDOW_MS = 12 * 60 * 1000;
export const STEP_BUDGET_MS = 30_000;
export const EMAIL_FAILED_TAG = "EMAIL_FAILED";
export const EMAIL_VOLUME_TAG = "EMAIL_VOLUME";

/** Writes the confirmation email's outbox row inside the order-creation transaction. Idempotent per order. */
export async function enqueueOrderConfirmation(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.emailLog.createMany({
    data: [{ orderId, template: EmailTemplate.order_confirmation }],
    skipDuplicates: true,
  });
}

/** Writes the shipped email's outbox row inside the ship transition's transaction. Idempotent per order. */
export async function enqueueOrderShipped(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.emailLog.createMany({
    data: [{ orderId, template: EmailTemplate.order_shipped }],
    skipDuplicates: true,
  });
}

export function recipientHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export interface EmailOutboxReport {
  examined: number;
  sent: number;
  retrying: number;
  failed: number;
  /** Abandoned sends re-queued inside the deduplication window. */
  staleSendingRequeued: number;
  /** Abandoned sends too old to resend safely — failed for a person. */
  staleSendingFailed: number;
  sentToday: number;
  /** True when the daily limit stopped sending; pending rows wait for tomorrow. */
  dailyLimitReached: boolean;
  /** True when the time budget stopped claiming; the rest wait for the next run. */
  budgetExhausted: boolean;
  /** True when Brevo refused the account (bad key / unverified sender); the queue waits for a person. */
  accountBlocked: boolean;
}

/** Start of today in India (the sending day the Brevo cap is counted against for this business). */
function startOfIndianDay(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 60 * 60 * 1000);
}

export async function sendPendingEmails(
  client: TransactionalEmailClient,
  now: Date = new Date(),
  options: { budgetMs?: number; clock?: () => number } = {},
): Promise<EmailOutboxReport> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const budgetMs = options.budgetMs ?? STEP_BUDGET_MS;
  const report: EmailOutboxReport = {
    examined: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    staleSendingRequeued: 0,
    staleSendingFailed: 0,
    sentToday: 0,
    dailyLimitReached: false,
    budgetExhausted: false,
    accountBlocked: false,
  };

  // Abandoned sends: still inside Brevo's dedup window → re-queue (the
  // same idempotency key makes a resend safe); older → a person checks.
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);
  const resendAfter = new Date(now.getTime() - RESEND_WINDOW_MS);
  const requeued = await prisma.emailLog.updateMany({
    where: { status: EmailStatus.sending, updatedAt: { lt: staleBefore, gte: resendAfter } },
    data: { status: EmailStatus.pending, lastError: "send interrupted; re-queued (idempotent resend)" },
  });
  report.staleSendingRequeued = requeued.count;
  const stale = await prisma.emailLog.updateMany({
    where: { status: EmailStatus.sending, updatedAt: { lt: resendAfter } },
    data: { status: EmailStatus.failed, lastError: "send interrupted beyond the dedup window; not resent (could duplicate)" },
  });
  report.staleSendingFailed = stale.count;
  if (stale.count > 0) console.error(`[email] ${EMAIL_FAILED_TAG} stale_sending=${stale.count}`);

  report.sentToday = await prisma.emailLog.count({
    where: { status: EmailStatus.sent, sentAt: { gte: startOfIndianDay(now) } },
  });

  const pending = await prisma.emailLog.findMany({
    where: { status: EmailStatus.pending },
    select: { id: true, orderId: true, template: true, attempts: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  report.examined = pending.length;

  for (const row of pending) {
    if (clock() - startedAt >= budgetMs) {
      report.budgetExhausted = true;
      break;
    }
    if (report.sentToday >= DAILY_LIMIT) {
      report.dailyLimitReached = true;
      console.error(`[email] ${EMAIL_VOLUME_TAG} daily limit ${DAILY_LIMIT} reached; ${pending.length - report.sent} pending wait`);
      break;
    }
    // Claim: only one run may move it to `sending`.
    const claimed = await prisma.emailLog.updateMany({
      where: { id: row.id, status: EmailStatus.pending },
      data: { status: EmailStatus.sending, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    try {
      const { to, email } = await renderFor(row.orderId, row.template);
      const { messageId } = await client.send({ ...email, idempotencyKey: row.id });
      await prisma.emailLog.update({
        where: { id: row.id },
        data: {
          status: EmailStatus.sent,
          providerMessageId: messageId,
          recipientHash: recipientHash(to),
          sentAt: now,
          lastError: null,
        },
        select: { id: true },
      });
      report.sent += 1;
      report.sentToday += 1;
      if (report.sentToday === DAILY_WARNING) {
        console.warn(`[email] ${EMAIL_VOLUME_TAG} ${DAILY_WARNING} sent today (Brevo free tier: 300/day)`);
      }
      console.info(`[email] sent template=${row.template} order=${row.orderId} message=${messageId}`);
    } catch (error) {
      if (error instanceof EmailSendError && error.kind === "account") {
        // Not this email's fault: put it back untouched and stop the batch.
        await prisma.emailLog.update({
          where: { id: row.id },
          data: { status: EmailStatus.pending, attempts: row.attempts, lastError: error.message.slice(0, 500) },
          select: { id: true },
        });
        report.accountBlocked = true;
        console.error(`[email] ${EMAIL_FAILED_TAG} account-level failure, queue paused: ${error.message.slice(0, 300)}`);
        break;
      }
      // Brevo said whether it is worth retrying; anything else (a database
      // blip while rendering) is retried within the attempt limit.
      const retryable = error instanceof EmailSendError ? error.retryable : true;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const giveUp = !retryable || row.attempts + 1 >= MAX_ATTEMPTS;
      await prisma.emailLog.update({
        where: { id: row.id },
        data: { status: giveUp ? EmailStatus.failed : EmailStatus.pending, lastError: message },
        select: { id: true },
      });
      if (giveUp) {
        report.failed += 1;
        console.error(`[email] ${EMAIL_FAILED_TAG} template=${row.template} order=${row.orderId}: ${message}`);
      } else {
        report.retrying += 1;
        console.warn(`[email] retry template=${row.template} order=${row.orderId} attempt=${row.attempts + 1}: ${message}`);
      }
    }
  }
  return report;
}

async function renderFor(
  orderId: string | null,
  template: EmailTemplate,
): Promise<{ to: string; email: Omit<OutgoingEmail, "idempotencyKey"> }> {
  if (orderId && template === EmailTemplate.order_shipped) return renderShipped(orderId);
  if (!orderId || template !== EmailTemplate.order_confirmation) {
    throw new EmailSendError(`no renderer for template ${template}`, false);
  }
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      orderNumber: true,
      placedAt: true,
      contactEmailEnc: true,
      subtotalPaise: true,
      discountPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      totalPaise: true,
      shipCity: true,
      shipState: true,
      shipPincode: true,
      items: {
        select: {
          productName: true,
          sizeLabel: true,
          colorway: true,
          quantity: true,
          lineSubtotalPaise: true,
          cgstPaise: true,
          sgstPaise: true,
          igstPaise: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  const to = decryptField(order.contactEmailEnc);
  const sum = (key: "cgstPaise" | "sgstPaise" | "igstPaise") => order.items.reduce((total, item) => total + item[key], 0);
  const rendered = renderOrderConfirmation({
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    items: order.items,
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    totalPaise: order.totalPaise,
    gst: { cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise") },
    shipTo: { city: order.shipCity, state: order.shipState, pincode: order.shipPincode },
    siteUrl: siteConfig.url,
  });
  return { to, email: { to, ...rendered } };
}

async function renderShipped(orderId: string): Promise<{ to: string; email: Omit<OutgoingEmail, "idempotencyKey"> }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      orderNumber: true,
      contactEmailEnc: true,
      courier: true,
      awb: true,
      shipCity: true,
      shipState: true,
      shipPincode: true,
      items: { select: { productName: true, sizeLabel: true, colorway: true, quantity: true }, orderBy: { id: "asc" } },
    },
  });
  if (!order.courier || !order.awb) throw new EmailSendError("order has no courier/AWB recorded", false);
  const to = decryptField(order.contactEmailEnc);
  const rendered = renderOrderShipped({
    orderNumber: order.orderNumber,
    courier: order.courier,
    awb: order.awb,
    items: order.items,
    shipTo: { city: order.shipCity, state: order.shipState, pincode: order.shipPincode },
    siteUrl: siteConfig.url,
  });
  return { to, email: { to, ...rendered } };
}
