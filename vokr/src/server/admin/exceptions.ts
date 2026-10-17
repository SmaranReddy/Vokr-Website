import { EmailStatus, OrderStatus, PaymentIssueState } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";
import { findOrderOrphans } from "@/server/orders/reconcile";

/**
 * The 2 a.m. screen (plan §5 Phase 12, task 8): every inconsistency class
 * the system can name, with the records behind it. Read-only; PII-free.
 */

/** A confirmed or preparing order untouched this long needs a person. */
export const STUCK_ORDER_HOURS = 48;
const LIMIT = 100;

export async function loadExceptions(now: Date = new Date()) {
  const stuckBefore = new Date(now.getTime() - STUCK_ORDER_HOURS * 60 * 60 * 1000);
  const [orphans, paymentIssues, failedEmails, webhookErrors, stuckOrders, missingCreditNotes] = await Promise.all([
    findOrderOrphans(),
    prisma.paymentIssue.findMany({
      where: { state: { in: [PaymentIssueState.open, PaymentIssueState.refund_initiated, PaymentIssueState.manual_review] } },
      select: {
        id: true,
        state: true,
        reason: true,
        providerPaymentId: true,
        amountPaise: true,
        refundId: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        payment: { select: { order: { select: { orderNumber: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: LIMIT,
    }),
    prisma.emailLog.findMany({
      where: { status: EmailStatus.failed },
      select: { id: true, template: true, attempts: true, lastError: true, updatedAt: true, order: { select: { orderNumber: true } } },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    prisma.webhookEvent.findMany({
      where: { processingError: { not: null } },
      select: { id: true, eventType: true, providerEventId: true, processingError: true, receivedAt: true },
      orderBy: { receivedAt: "desc" },
      take: LIMIT,
    }),
    prisma.order.findMany({
      where: { status: { in: [OrderStatus.confirmed, OrderStatus.preparing] }, updatedAt: { lt: stuckBefore } },
      select: { orderNumber: true, status: true, placedAt: true, updatedAt: true },
      orderBy: { placedAt: "asc" },
      take: LIMIT,
    }),
    // Refunded and invoiced, still waiting on its credit note (normally
    // minutes; longer means the maintenance step is failing).
    prisma.order.findMany({
      where: { status: OrderStatus.refunded, invoice: { isNot: null }, creditNote: { is: null } },
      select: { orderNumber: true, updatedAt: true, invoice: { select: { invoiceNumber: true } } },
      orderBy: { updatedAt: "asc" },
      take: LIMIT,
    }),
  ]);
  return { orphans, paymentIssues, failedEmails, webhookErrors, stuckOrders, missingCreditNotes };
}

export type AdminExceptions = Awaited<ReturnType<typeof loadExceptions>>;
