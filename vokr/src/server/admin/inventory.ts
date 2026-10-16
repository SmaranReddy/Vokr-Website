import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { invalidateCatalogCache } from "@/server/catalog/service";
import { prisma } from "@/server/db/client";
import { runLockingTransaction } from "@/server/inventory/transaction";

import { writeAudit } from "./audit";

/**
 * Stock adjustment with a mandatory reason (plan §5 Phase 12, task 5) — also
 * how launch stock is entered, and how units come back after a cancellation,
 * RTO or return (refunds never restock on their own).
 *
 * The operator states the on-hand they saw (`expectedOnHand`); if it moved
 * since (a sale, another operator, a double submit) the adjustment is
 * refused rather than applied on top. On-hand can never drop below the
 * units currently held by live checkouts, and the table's CHECKs remain the
 * backstop.
 */

export const adjustInventorySchema = z
  .object({
    variantId: z.string().uuid(),
    delta: z.number().int().min(-10_000).max(10_000).refine((value) => value !== 0, "delta must not be zero"),
    expectedOnHand: z.number().int().min(0),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

export async function adjustInventory(
  actor: string,
  input: AdjustInventoryInput,
  requestId?: string,
): Promise<{ quantityOnHand: number; quantityReserved: number }> {
  const result = await runLockingTransaction("admin.adjust", async (tx) => {
    const [row] = await tx.$queryRaw<{ quantity_on_hand: number; quantity_reserved: number }[]>`
      SELECT quantity_on_hand, quantity_reserved FROM inventory
       WHERE variant_id = ${input.variantId}::uuid
         FOR UPDATE
    `;
    if (!row) throw new NotFoundError("No stock record for that variant.");
    if (row.quantity_on_hand !== input.expectedOnHand) {
      throw new ConflictError(
        `Stock changed since you loaded it (on hand is now ${row.quantity_on_hand}). Reload and try again.`,
      );
    }
    const next = row.quantity_on_hand + input.delta;
    if (next < 0) throw new ValidationError("On-hand stock cannot go below zero.");
    if (next < row.quantity_reserved) {
      throw new ConflictError(
        `${row.quantity_reserved} unit(s) are held by checkouts in progress; on hand cannot go below that.`,
      );
    }
    await tx.$executeRaw`
      UPDATE inventory SET quantity_on_hand = ${next}::int, updated_at = now()
       WHERE variant_id = ${input.variantId}::uuid
    `;
    await writeAudit(tx, {
      actor,
      action: "inventory.adjust",
      entity: "inventory",
      entityId: input.variantId,
      before: { quantityOnHand: row.quantity_on_hand, quantityReserved: row.quantity_reserved },
      after: { quantityOnHand: next, quantityReserved: row.quantity_reserved, delta: input.delta },
      reason: input.reason,
      requestId,
    });
    return { quantityOnHand: next, quantityReserved: row.quantity_reserved };
  });
  invalidateCatalogCache();
  return result;
}

export interface AdminStockRow {
  variantId: string;
  sku: string;
  productName: string;
  sizeLabel: string;
  colorway: string;
  variantStatus: string;
  quantityOnHand: number;
  quantityReserved: number;
}

/** Every variant's stock, for the inventory screen. Five SKUs at launch — no paging. */
export async function listStock(): Promise<AdminStockRow[]> {
  const variants = await prisma.productVariant.findMany({
    select: {
      id: true,
      sku: true,
      sizeLabel: true,
      colorway: true,
      status: true,
      product: { select: { name: true } },
      inventory: { select: { quantityOnHand: true, quantityReserved: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
  });
  return variants.map((variant) => ({
    variantId: variant.id,
    sku: variant.sku,
    productName: variant.product.name,
    sizeLabel: variant.sizeLabel,
    colorway: variant.colorway,
    variantStatus: variant.status,
    quantityOnHand: variant.inventory?.quantityOnHand ?? 0,
    quantityReserved: variant.inventory?.quantityReserved ?? 0,
  }));
}
