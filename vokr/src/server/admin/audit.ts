import type { Prisma } from "@/generated/prisma/client";

/**
 * One `audit_log` row (plan §5 Phase 12, task 10). Always called with the
 * transaction that makes the change, so the record and the change commit
 * or roll back together. `before`/`after` must never carry PII.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason?: string;
    requestId?: string;
  },
): Promise<void> {
  await tx.auditLog.create({ data: entry, select: { id: true } });
  console.info(`[admin] AUDIT actor=${entry.actor} action=${entry.action} ${entry.entity}=${entry.entityId}`);
}
