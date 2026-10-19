import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { ConsentAction, type ConsentPurpose } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

/**
 * Consent records (plan §5 Phase 17, tasks 1–2; DPDP). Append-only:
 * the table's trigger refuses UPDATE and DELETE, so a withdrawal is a new
 * `withdrawn` row and the history stays provable.
 *
 * Recorded where consent is actually given today — creating an account
 * (the terms say that is acceptance of the Terms and Privacy Policy) and
 * the footer newsletter (marketing email). Checkout and cookies are not
 * recorded: checkout processes data to fulfil the order, and the site
 * sets no non-essential cookies or analytics. Both are open questions in
 * `docs/privacy/legal-review-proposal.md`.
 *
 * Recorded **before** the action it covers, so an account or subscription
 * never exists without its record.
 */

/** The Privacy Policy version a visitor saw: its own "Last updated" label (`app/(legal)/privacy-policy`). Change both together. */
export const PRIVACY_POLICY_VERSION = "January 2026";

/** SHA-256 of the normalised email. Pseudonymised, not anonymised: a known address can be hashed and matched. */
export function consentSubjectHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** SHA-256 of the client IP, never the IP itself. */
export function consentIpHash(ip: string): string | null {
  if (!ip || ip === "unknown") return null;
  return createHash("sha256").update(`consent:ip:${ip}`).digest("hex");
}

export interface ConsentInput {
  email: string;
  purpose: ConsentPurpose;
  action?: ConsentAction;
  source: string;
  ip: string;
  userId?: string | null;
}

export async function recordConsent(input: ConsentInput, tx: Prisma.TransactionClient = prisma): Promise<void> {
  await tx.consentRecord.create({
    data: {
      userId: input.userId ?? null,
      subjectHash: consentSubjectHash(input.email),
      purpose: input.purpose,
      action: input.action ?? ConsentAction.granted,
      policyVersion: PRIVACY_POLICY_VERSION,
      source: input.source,
      ipHash: consentIpHash(input.ip),
    },
    select: { id: true },
  });
  console.info(`[privacy] CONSENT purpose=${input.purpose} action=${input.action ?? ConsentAction.granted} source=${input.source}`);
}

/** Every consent row about an account: by its id or by its email's hash (a newsletter signup made before the account). */
export async function consentHistory(userId: string, email: string) {
  return prisma.consentRecord.findMany({
    where: { OR: [{ userId }, { subjectHash: consentSubjectHash(email) }] },
    select: { purpose: true, action: true, policyVersion: true, source: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}
