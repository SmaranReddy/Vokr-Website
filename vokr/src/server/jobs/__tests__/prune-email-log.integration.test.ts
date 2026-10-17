import { afterAll, afterEach, describe, expect, it } from "vitest";

import { EmailStatus, EmailTemplate } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { EMAIL_LOG_RETENTION_DAYS, pruneExpiredRows } from "../prune";

/** Plan §5 Phase 11, Database Impact: `email_log` pruned at 180 days — only rows that finished. */

const DAY = 86_400_000;
const ids: string[] = [];

async function row(status: EmailStatus, ageDays: number, sent: boolean): Promise<string> {
  const at = new Date(Date.now() - ageDays * DAY);
  const created = await prisma.emailLog.create({
    data: {
      template: EmailTemplate.order_confirmation,
      status,
      // A `sent` row must say when, to whom (hash) and Brevo's id (CHECK email_log_sent_is_complete).
      ...(sent ? { sentAt: at, recipientHash: "a".repeat(64), providerMessageId: `<msg-${ageDays}@test>` } : {}),
    },
    select: { id: true },
  });
  // `updated_at` is maintained by Prisma; backdate it directly.
  await prisma.$executeRaw`UPDATE email_log SET updated_at = ${at}, created_at = ${at} WHERE id = ${created.id}::uuid`;
  ids.push(created.id);
  return created.id;
}

afterEach(async () => {
  await prisma.emailLog.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("email_log retention", () => {
  it("deletes finished rows past the retention window and keeps everything else", async () => {
    const past = EMAIL_LOG_RETENTION_DAYS + 1;
    const recent = EMAIL_LOG_RETENTION_DAYS - 1;
    const oldSent = await row(EmailStatus.sent, past, true);
    const oldFailed = await row(EmailStatus.failed, past, false);
    const recentSent = await row(EmailStatus.sent, recent, true);
    const recentFailed = await row(EmailStatus.failed, recent, false);
    // In flight, however old: never pruned.
    const oldPending = await row(EmailStatus.pending, past, false);
    const oldSending = await row(EmailStatus.sending, past, false);

    const report = await pruneExpiredRows();
    expect(report.emailLog).toBeGreaterThanOrEqual(2);

    const left = await prisma.emailLog.findMany({ where: { id: { in: ids } }, select: { id: true } });
    expect(left.map((entry) => entry.id).sort()).toEqual([recentSent, recentFailed, oldPending, oldSending].sort());
    expect(left.map((entry) => entry.id)).not.toContain(oldSent);
    expect(left.map((entry) => entry.id)).not.toContain(oldFailed);
  });
});
