import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { creditNoteNumberFor, financialYearOf } from "./format";
import { nextSerial } from "./issue";

/**
 * GST credit notes for refunded, invoiced orders (CGST Act s.34; r.53 —
 * pending CA review).
 *
 * Issued by the maintenance job, after the refund has been recorded and in
 * a transaction of its own — never inside the payment path, so nothing
 * here can ever fail or roll back the recording of a refund (the same rule
 * as the email outbox). s.34 allows time; a run every 5 minutes is well
 * within it, and the admin Exceptions view shows any order still waiting.
 *
 * Only full refunds produce an order in `refunded`; a partial refund made
 * in the Razorpay dashboard never does, so it never gets a credit note
 * here — that is a person's job (see the runbook).
 */

export const CREDIT_NOTE_REASON = "Full refund of the order";
export const CREDIT_NOTE_FAILED_TAG = "CREDIT_NOTE_FAILED";
const BATCH_SIZE = 50;

/**
 * Issues the credit note for one order, idempotently. Lock order: the order
 * row first, then the counter (refunds take payment → order, so there is
 * no cycle). Returns `null` when the order is not refunded or was never
 * invoiced — nothing to credit.
 */
export async function issueCreditNote(
  tx: Prisma.TransactionClient,
  orderId: string,
  options: { now?: Date } = {},
): Promise<{ creditNoteNumber: string; created: boolean } | null> {
  const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
    SELECT status FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `;
  if (!order || order.status !== OrderStatus.refunded) return null;

  const existing = await tx.creditNote.findUnique({ where: { orderId }, select: { creditNoteNumber: true } });
  if (existing) return { creditNoteNumber: existing.creditNoteNumber, created: false };

  const invoice = await tx.invoice.findUnique({ where: { orderId }, select: { id: true, seller: true } });
  if (!invoice) return null;

  const issuedAt = options.now ?? new Date();
  const financialYear = financialYearOf(issuedAt);
  const serial = await nextSerial(tx, "credit_note", financialYear);
  const creditNoteNumber = creditNoteNumberFor(financialYear, serial);
  await tx.creditNote.create({
    data: {
      orderId,
      invoiceId: invoice.id,
      creditNoteNumber,
      financialYear,
      serial,
      // The invoice's seller snapshot — never configuration, so a later
      // config change cannot block or alter a credit note.
      seller: invoice.seller as Prisma.InputJsonValue,
      reason: CREDIT_NOTE_REASON,
      issuedAt,
    },
    select: { id: true },
  });
  console.info(`[invoices] credit note ${creditNoteNumber} order=${orderId}`);
  return { creditNoteNumber, created: true };
}

export interface CreditNoteReport {
  examined: number;
  issued: number;
  errors: number;
}

/** The maintenance step: every refunded, invoiced order still without a credit note. One failure never blocks the rest. */
export async function issuePendingCreditNotes(now: Date = new Date()): Promise<CreditNoteReport> {
  const pending = await prisma.order.findMany({
    where: { status: OrderStatus.refunded, invoice: { isNot: null }, creditNote: { is: null } },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: BATCH_SIZE,
  });
  const report: CreditNoteReport = { examined: pending.length, issued: 0, errors: 0 };
  for (const { id } of pending) {
    try {
      const result = await prisma.$transaction((tx) => issueCreditNote(tx, id, { now }));
      if (result?.created) report.issued += 1;
    } catch (error) {
      report.errors += 1;
      console.error(`[invoices] ${CREDIT_NOTE_FAILED_TAG} order=${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return report;
}
