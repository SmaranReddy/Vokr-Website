import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  CheckoutState,
  DataSubjectRequestKind,
  DataSubjectRequestState,
  OrderStatus,
  PaymentIssueState,
} from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { writeAudit } from "@/server/admin/audit";
import { encryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";

/**
 * DPDP erasure (plan §5 Phase 17, tasks 5–6). Three steps, never one:
 *
 * 1. **Request** — the signed-in customer asks (`POST /api/privacy/delete`).
 *    Nothing changes but a `data_subject_requests` row.
 * 2. **Decide** — an operator reads the dry-run report (what would be
 *    anonymised, what is kept and why, what blocks it) and approves or
 *    rejects, retyping the account email. Audited.
 * 3. **Execute** — only an approved request, only while nothing blocks it,
 *    and only when {@link ERASURE_EXECUTION_ENABLED} is on. One
 *    transaction: PII is replaced with tombstones **in place**; orders,
 *    their totals, payments and history survive for the tax-record
 *    obligation. Irreversible — so it is off until the legal review in
 *    `docs/privacy/legal-review-proposal.md` settles what an order must keep.
 *
 * What execution does **not** do (reported as manual steps): delete the
 * Supabase Auth user (needs the service-role key; until then the session
 * layer treats the account as signed out) and remove the Brevo contact.
 */

/**
 * Off until legal review confirms which order fields a tax record must
 * keep. Enabling it is a reviewed code change, the same discipline as
 * `ORDERING_ENABLED` — never an environment toggle.
 */
export const ERASURE_EXECUTION_ENABLED: boolean = false;

export const ERASED = "[erased]";
const erasedEmail = (userId: string) => `erased-${userId}@erased.invalid`;

/** Statuses in which an order is still being fulfilled: erasing its contact details would strand the delivery. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.confirmed, OrderStatus.preparing, OrderStatus.shipped];
/** Checkouts where money may still move. */
const ACTIVE_CHECKOUT_STATES: CheckoutState[] = [CheckoutState.reserved, CheckoutState.payment_pending];
const OPEN_ISSUE_STATES: PaymentIssueState[] = [PaymentIssueState.open, PaymentIssueState.refund_initiated, PaymentIssueState.manual_review];

export interface ErasureReport {
  /** What would block execution right now; empty means it can run. */
  blockers: string[];
  anonymise: {
    account: number;
    addresses: number;
    checkoutContactEmails: number;
    /** Orders whose contact email and phone become tombstones. */
    orderContacts: number;
  };
  /** Kept on purpose, pending legal review — counts only. */
  retained: {
    /** Ship-to name, address lines, city, state, PIN: the tax invoice's recipient (legal review Q1). */
    orderShipTo: number;
    /** Proof that consent was given (pseudonymous hash, no email). */
    consentRecords: number;
  };
  manualSteps: string[];
}

type Db = Prisma.TransactionClient | typeof prisma;

async function buildReport(db: Db, userId: string): Promise<ErasureReport> {
  const [activeOrders, activeCheckouts, openIssues, addresses, checkoutEmails, orders, consents] = await Promise.all([
    db.order.count({ where: { userId, status: { in: ACTIVE_ORDER_STATUSES } } }),
    db.checkoutSession.count({ where: { userId, state: { in: ACTIVE_CHECKOUT_STATES } } }),
    db.paymentIssue.count({ where: { state: { in: OPEN_ISSUE_STATES }, payment: { checkoutSession: { userId } } } }),
    db.address.count({ where: { userId } }),
    db.checkoutSession.count({ where: { userId, contactEmailEnc: { not: null } } }),
    db.order.count({ where: { userId } }),
    db.consentRecord.count({ where: { userId } }),
  ]);
  const blockers: string[] = [];
  if (activeOrders > 0) blockers.push(`${activeOrders} order(s) still being fulfilled (confirmed, preparing or shipped)`);
  if (activeCheckouts > 0) blockers.push(`${activeCheckouts} checkout(s) holding stock or awaiting payment`);
  if (openIssues > 0) blockers.push(`${openIssues} refund(s) or payment issue(s) still open`);
  return {
    blockers,
    anonymise: { account: 1, addresses, checkoutContactEmails: checkoutEmails, orderContacts: orders },
    retained: { orderShipTo: orders, consentRecords: consents },
    manualSteps: [
      "Delete the Supabase Auth user (dashboard or service-role key); until then the account is treated as signed out.",
      "Remove the email from Brevo contacts if it subscribed to the newsletter.",
    ],
  };
}

const requestSelect = { id: true, userId: true, state: true, kind: true, report: true, createdAt: true, decidedAt: true, completedAt: true } as const;

/** Step 1. Idempotent: an open request is returned as it is, never a second one. */
export async function requestErasure(userId: string) {
  const open = await prisma.dataSubjectRequest.findFirst({
    where: { userId, kind: DataSubjectRequestKind.erasure, state: { in: [DataSubjectRequestState.requested, DataSubjectRequestState.approved] } },
    select: requestSelect,
  });
  if (open) return { request: open, created: false };
  try {
    const request = await prisma.dataSubjectRequest.create({
      data: { userId, kind: DataSubjectRequestKind.erasure },
      select: requestSelect,
    });
    console.info(`[privacy] ERASURE_REQUESTED request=${request.id} user=${userId}`);
    return { request, created: true };
  } catch (error) {
    // A concurrent request won the one-open-per-account index.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const request = await prisma.dataSubjectRequest.findFirstOrThrow({
        where: { userId, kind: DataSubjectRequestKind.erasure, state: { in: [DataSubjectRequestState.requested, DataSubjectRequestState.approved] } },
        select: requestSelect,
      });
      return { request, created: false };
    }
    throw error;
  }
}

/** The dry run an operator reads before deciding. Changes nothing. */
export async function previewErasure(requestId: string) {
  assertRequestId(requestId);
  const request = await prisma.dataSubjectRequest.findUnique({ where: { id: requestId }, select: requestSelect });
  if (!request) throw new NotFoundError("Request not found.");
  return { request, report: await buildReport(prisma, request.userId), executionEnabled: ERASURE_EXECUTION_ENABLED };
}

export const decideErasureSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** The account email, retyped: a second confirmation for an irreversible action. */
    confirmEmail: z.string().trim().min(3).max(320),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const UUID = z.uuid();
/** A malformed id is a plain 404, never a database cast error. */
function assertRequestId(requestId: string): void {
  if (!UUID.safeParse(requestId).success) throw new NotFoundError("Request not found.");
}

async function lockRequest(tx: Prisma.TransactionClient, requestId: string) {
  assertRequestId(requestId);
  const [row] = await tx.$queryRaw<{ id: string; user_id: string; state: DataSubjectRequestState }[]>`
    SELECT id, user_id, state FROM data_subject_requests WHERE id = ${requestId}::uuid FOR UPDATE
  `;
  if (!row) throw new NotFoundError("Request not found.");
  return row;
}

/** Step 2. Approve or reject once; audited in the same transaction. */
export async function decideErasure(actor: string, requestId: string, input: z.infer<typeof decideErasureSchema>, auditRequestId?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    if (row.state !== DataSubjectRequestState.requested) {
      throw new ConflictError(`This request is already ${row.state}.`);
    }
    const user = await tx.appUser.findUniqueOrThrow({ where: { id: row.user_id }, select: { email: true } });
    if (user.email.toLowerCase() !== input.confirmEmail.toLowerCase()) {
      throw new ValidationError("The email does not match this account.");
    }
    const state = input.decision === "approve" ? DataSubjectRequestState.approved : DataSubjectRequestState.rejected;
    const report = await buildReport(tx, row.user_id);
    await tx.dataSubjectRequest.update({
      where: { id: requestId },
      data: { state, decidedBy: actor, decidedAt: new Date(), decisionReason: input.reason, report: report as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor,
      action: `privacy.erasure_${input.decision}`,
      entity: "data_subject_request",
      entityId: requestId,
      before: { state: row.state },
      after: { state, blockers: report.blockers.length },
      reason: input.reason,
      requestId: auditRequestId,
    });
    return { state, report };
  });
}

/**
 * Step 3. Anonymises in place, in one transaction, after re-checking the
 * blockers under the account's row lock. `enabled` defaults to the
 * code constant; tests pass `true` against the integration database.
 */
export async function executeErasure(actor: string, requestId: string, options: { enabled?: boolean; requestId?: string } = {}) {
  const enabled = options.enabled ?? ERASURE_EXECUTION_ENABLED;
  if (!enabled) {
    throw new ConflictError("Erasure execution is disabled until the legal review is complete (ERASURE_EXECUTION_ENABLED).");
  }
  return prisma.$transaction(async (tx) => {
    const row = await lockRequest(tx, requestId);
    if (row.state !== DataSubjectRequestState.approved) {
      throw new ConflictError(`Only an approved request can be executed; this one is ${row.state}.`);
    }
    const userId = row.user_id;
    await tx.$queryRaw`SELECT id FROM app_users WHERE id = ${userId}::uuid FOR UPDATE`;
    const report = await buildReport(tx, userId);
    if (report.blockers.length > 0) {
      throw new ConflictError(`Cannot erase yet: ${report.blockers.join("; ")}.`);
    }

    const now = new Date();
    const tombstone = encryptField(ERASED);
    await tx.appUser.update({
      where: { id: userId },
      data: { email: erasedEmail(userId), displayName: null, phoneEnc: null, deletedAt: now, isAdmin: false },
      select: { id: true },
    });
    await tx.address.updateMany({
      where: { userId },
      data: { nameEnc: tombstone, line1Enc: tombstone, line2Enc: null, phoneEnc: tombstone, city: ERASED },
    });
    await tx.checkoutSession.updateMany({ where: { userId }, data: { contactEmailEnc: null } });
    await tx.order.updateMany({
      where: { userId },
      data: { contactEmailEnc: encryptField(erasedEmail(userId)), shipPhoneEnc: tombstone },
    });

    await tx.dataSubjectRequest.update({
      where: { id: requestId },
      data: { state: DataSubjectRequestState.completed, completedAt: now, report: report as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor,
      action: "privacy.erasure_execute",
      entity: "data_subject_request",
      entityId: requestId,
      before: { state: row.state },
      after: { state: DataSubjectRequestState.completed, anonymise: report.anonymise, retained: report.retained },
      requestId: options.requestId,
    });
    console.warn(`[privacy] ERASURE_EXECUTED request=${requestId} user=${userId}`);
    return { state: DataSubjectRequestState.completed, report };
  });
}

/** Requests waiting for an operator, oldest first (the statutory clock runs from the request). */
export async function listOpenErasureRequests() {
  return prisma.dataSubjectRequest.findMany({
    where: { state: { in: [DataSubjectRequestState.requested, DataSubjectRequestState.approved] } },
    select: requestSelect,
    orderBy: { createdAt: "asc" },
  });
}
