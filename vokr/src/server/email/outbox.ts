import { createHash } from "node:crypto";

import { EmailStatus, EmailTemplate } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { siteConfig } from "@/config/site";
import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";

import { EmailSendError, type TransactionalEmailClient } from "./brevo";
import { renderOrderConfirmation } from "./templates/order-confirmation";

/**
 * The email outbox (plan §5 Phase 11, tasks 4–6, 8). Rows are written
 * `pending` in the same transaction as the event (`enqueueOrderConfirmation`
 * inside order creation) and sent here, by the maintenance job, after that
 * transaction has committed — so an email can never fail, slow or roll back
 * a payment.
 *
 * - **One email per order event:** `UNIQUE(order_id, template)`.
 * - **No double send:** a row is claimed `pending → sending` by a
 *   conditional update; overlapping runs cannot both send it. Brevo has no
 *   idempotency key, so a row left `sending` (a crash mid-send) is never
 *   resent automatically — it goes to `failed` for a person.
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
export const STALE_SENDING_MS = 15 * 60 * 1000;
export const EMAIL_FAILED_TAG = "EMAIL_FAILED";
export const EMAIL_VOLUME_TAG = "EMAIL_VOLUME";

/** Writes the confirmation email's outbox row inside the order-creation transaction. Idempotent per order. */
export async function enqueueOrderConfirmation(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.emailLog.createMany({
    data: [{ orderId, template: EmailTemplate.order_confirmation }],
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
  staleSendingFailed: number;
  sentToday: number;
  /** True when the daily limit stopped sending; pending rows wait for tomorrow. */
  dailyLimitReached: boolean;
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
): Promise<EmailOutboxReport> {
  const report: EmailOutboxReport = {
    examined: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    staleSendingFailed: 0,
    sentToday: 0,
    dailyLimitReached: false,
  };

  // A send that never finished: never resent (no idempotency key) — a person checks.
  const stale = await prisma.emailLog.updateMany({
    where: { status: EmailStatus.sending, updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { status: EmailStatus.failed, lastError: "send interrupted; not resent automatically (could duplicate)" },
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
      const { messageId } = await client.send(email);
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
): Promise<{ to: string; email: { to: string; subject: string; text: string; html: string } }> {
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
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    totalPaise: order.totalPaise,
    gst: { cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), igstPaise: sum("igstPaise") },
    shipTo: { city: order.shipCity, state: order.shipState, pincode: order.shipPincode },
    siteUrl: siteConfig.url,
  });
  return { to, email: { to, ...rendered } };
}
