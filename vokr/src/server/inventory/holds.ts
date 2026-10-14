import { ReservationState } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { ConflictError, OutOfStockError, type UnavailableLine } from "@/lib/errors";
import { MAX_CART_ITEM_QUANTITY } from "@/lib/cart";

/**
 * Stock holds (plan §5 Phase 8, §3.5 transaction boundary). Every function
 * here takes the caller's transaction and must run **inside** a
 * {@link import("./transaction").runLockingTransaction} body that has
 * already locked the checkout session row — that session lock is what
 * serialises everything that can happen to one session's holds (a
 * duplicate reserve, a capture, the expiry job).
 *
 * Lock order, everywhere: `payments` row (if any) → `checkout_sessions`
 * row → `inventory` rows `ORDER BY variant_id`. A fixed order is what
 * makes two carts holding the same variants in opposite order unable to
 * deadlock.
 *
 * This module never imports the payments module, and never makes a
 * network call: the Razorpay order is created only after the reservation
 * transaction has committed (R9). An architecture test pins both.
 */

/** Reservations last 15 minutes from the reservation transaction (plan §5 Phase 8, task 4). */
export const RESERVATION_TTL_MINUTES = 15;

/**
 * Denial-of-inventory bound (Phase 8 Security Requirements): one identity
 * may hold at most this many units of a variant across all of its live
 * checkout sessions — the same ceiling as one cart line.
 */
export const MAX_HELD_UNITS_PER_IDENTITY_PER_VARIANT = MAX_CART_ITEM_QUANTITY;

export interface HoldLine {
  variantId: string;
  quantity: number;
}

export type { UnavailableLine };

export type HoldOwner = { userId: string } | { guestSessionId: string };

/** 409 `OUT_OF_STOCK` — at least one line cannot be held. Nothing was reserved: the whole transaction rolled back. */
export class InsufficientStockError extends OutOfStockError {
  constructor(readonly unavailable: readonly UnavailableLine[]) {
    super("Some items in your bag are no longer available in the quantity requested.", unavailable);
  }
}

interface LockedInventoryRow {
  variant_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  purchasable: boolean;
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * `SELECT … FOR UPDATE` on the inventory rows, in `variant_id` order.
 * Postgres locks rows as they leave the sort, so the lock order is the
 * `ORDER BY` order. Variant and product status are read in the same
 * statement: a variant archived after the session was priced cannot be
 * reserved.
 */
async function lockInventory(
  tx: Prisma.TransactionClient,
  variantIds: readonly string[],
): Promise<Map<string, LockedInventoryRow>> {
  const ids = sortedUnique(variantIds);
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT i.variant_id::text AS variant_id,
           i.quantity_on_hand,
           i.quantity_reserved,
           (v.status = 'active' AND p.status = 'active') AS purchasable
      FROM inventory i
      JOIN product_variants v ON v.id = i.variant_id
      JOIN products p ON p.id = v.product_id
     WHERE i.variant_id = ANY(${ids}::uuid[])
     ORDER BY i.variant_id
       FOR UPDATE OF i
  `;
  return new Map(rows.map((row) => [row.variant_id, row]));
}

/** Units this identity already holds per variant in its *other* live sessions. Read after the inventory rows are locked, so it cannot change underneath the check. */
async function unitsHeldElsewhere(
  tx: Prisma.TransactionClient,
  owner: HoldOwner,
  checkoutSessionId: string,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const ownerFilter =
    "userId" in owner
      ? Prisma.sql`s.user_id = ${owner.userId}::uuid`
      : Prisma.sql`s.guest_session_id = ${owner.guestSessionId}::uuid`;
  const rows = await tx.$queryRaw<{ variant_id: string; held: bigint }[]>`
    SELECT r.variant_id::text AS variant_id, SUM(r.quantity)::bigint AS held
      FROM inventory_reservations r
      JOIN checkout_sessions s ON s.id = r.checkout_session_id
     WHERE r.state = 'held'
       AND r.expires_at > now()
       AND r.variant_id = ANY(${sortedUnique(variantIds)}::uuid[])
       AND r.checkout_session_id <> ${checkoutSessionId}::uuid
       AND ${ownerFilter}
     GROUP BY r.variant_id
  `;
  return new Map(rows.map((row) => [row.variant_id, Number(row.held)]));
}

/**
 * The reservation transaction body (plan §3.5): lock every line's
 * inventory row, validate all of them, then increment
 * `quantity_reserved` and insert the holds. All lines or none — a single
 * short line throws {@link InsufficientStockError} and the caller's
 * transaction rolls back. `expires_at` comes from the database clock.
 */
export async function holdStock(
  tx: Prisma.TransactionClient,
  input: { checkoutSessionId: string; owner: HoldOwner; lines: readonly HoldLine[] },
): Promise<{ expiresAt: Date }> {
  const { checkoutSessionId, owner } = input;
  const lines = [...input.lines].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  if (lines.length === 0) {
    throw new ConflictError("There is nothing to reserve.");
  }
  if (new Set(lines.map((line) => line.variantId)).size !== lines.length) {
    throw new ConflictError("A variant appears twice in the pricing snapshot.");
  }

  const locked = await lockInventory(
    tx,
    lines.map((line) => line.variantId),
  );
  const unavailable: UnavailableLine[] = [];
  for (const line of lines) {
    const row = locked.get(line.variantId);
    const available = row && row.purchasable ? row.quantity_on_hand - row.quantity_reserved : 0;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || available < line.quantity) {
      unavailable.push({ variantId: line.variantId, requested: line.quantity, available: Math.max(0, available) });
    }
  }
  if (unavailable.length > 0) {
    for (const line of unavailable) {
      console.warn(
        `[inventory] DENY session=${checkoutSessionId} variant=${line.variantId} requested=${line.requested} available=${line.available}`,
      );
    }
    throw new InsufficientStockError(unavailable);
  }

  const heldElsewhere = await unitsHeldElsewhere(
    tx,
    owner,
    checkoutSessionId,
    lines.map((line) => line.variantId),
  );
  for (const line of lines) {
    const already = heldElsewhere.get(line.variantId) ?? 0;
    if (already + line.quantity > MAX_HELD_UNITS_PER_IDENTITY_PER_VARIANT) {
      console.warn(
        `[inventory] DENY session=${checkoutSessionId} variant=${line.variantId} requested=${line.quantity} held_by_identity=${already} (per-identity cap)`,
      );
      throw new ConflictError(
        "Some items in your bag are already held in another checkout. Finish or wait for that one first.",
      );
    }
  }

  const [clock] = await tx.$queryRaw<{ expires_at: Date }[]>`
    SELECT now() + make_interval(mins => ${RESERVATION_TTL_MINUTES}::int) AS expires_at
  `;
  const expiresAt = clock?.expires_at;
  if (!expiresAt) throw new Error("Database clock read returned no row.");

  for (const line of lines) {
    const row = locked.get(line.variantId) as LockedInventoryRow;
    await tx.$executeRaw`
      UPDATE inventory
         SET quantity_reserved = quantity_reserved + ${line.quantity}::int, updated_at = now()
       WHERE variant_id = ${line.variantId}::uuid
    `;
    console.info(
      `[inventory] GRANT session=${checkoutSessionId} variant=${line.variantId} qty=${line.quantity} on_hand=${row.quantity_on_hand} reserved=${row.quantity_reserved + line.quantity} expires_at=${expiresAt.toISOString()}`,
    );
  }

  await tx.inventoryReservation.createMany({
    data: lines.map((line) => ({
      checkoutSessionId,
      variantId: line.variantId,
      quantity: line.quantity,
      state: ReservationState.held,
      expiresAt,
    })),
  });

  return { expiresAt };
}

async function heldLines(
  tx: Prisma.TransactionClient,
  checkoutSessionId: string,
): Promise<HoldLine[]> {
  return tx.inventoryReservation.findMany({
    where: { checkoutSessionId, state: ReservationState.held },
    select: { variantId: true, quantity: true },
    orderBy: { variantId: "asc" },
  });
}

/**
 * Commit on capture (plan §5 Phase 8, task 6): the held units leave stock
 * for good — `quantity_on_hand` and `quantity_reserved` both drop, so
 * available stock is unchanged by the commit itself. Returns the number of
 * lines committed; `0` means there was nothing held (the caller decides
 * whether that needs a human).
 */
export async function commitHolds(
  tx: Prisma.TransactionClient,
  checkoutSessionId: string,
): Promise<number> {
  const lines = await heldLines(tx, checkoutSessionId);
  if (lines.length === 0) return 0;

  const locked = await lockInventory(
    tx,
    lines.map((line) => line.variantId),
  );
  for (const line of lines) {
    await tx.$executeRaw`
      UPDATE inventory
         SET quantity_on_hand = quantity_on_hand - ${line.quantity}::int,
             quantity_reserved = quantity_reserved - ${line.quantity}::int,
             updated_at = now()
       WHERE variant_id = ${line.variantId}::uuid
    `;
    const row = locked.get(line.variantId);
    console.info(
      `[inventory] COMMIT session=${checkoutSessionId} variant=${line.variantId} qty=${line.quantity} on_hand=${row ? row.quantity_on_hand - line.quantity : "?"} reserved=${row ? row.quantity_reserved - line.quantity : "?"}`,
    );
  }
  await tx.inventoryReservation.updateMany({
    where: { checkoutSessionId, state: ReservationState.held },
    data: { state: ReservationState.committed },
  });
  return lines.length;
}

/**
 * Returns held units to available stock — on expiry, or on any other end
 * of a session that did not end in a capture. Returns the number of lines
 * released.
 */
export async function releaseHolds(
  tx: Prisma.TransactionClient,
  checkoutSessionId: string,
  to: typeof ReservationState.released | typeof ReservationState.expired,
): Promise<number> {
  const lines = await heldLines(tx, checkoutSessionId);
  if (lines.length === 0) return 0;

  const locked = await lockInventory(
    tx,
    lines.map((line) => line.variantId),
  );
  for (const line of lines) {
    await tx.$executeRaw`
      UPDATE inventory
         SET quantity_reserved = quantity_reserved - ${line.quantity}::int, updated_at = now()
       WHERE variant_id = ${line.variantId}::uuid
    `;
    const row = locked.get(line.variantId);
    console.info(
      `[inventory] RELEASE(${to}) session=${checkoutSessionId} variant=${line.variantId} qty=${line.quantity} on_hand=${row?.quantity_on_hand ?? "?"} reserved=${row ? row.quantity_reserved - line.quantity : "?"}`,
    );
  }
  await tx.inventoryReservation.updateMany({
    where: { checkoutSessionId, state: ReservationState.held },
    data: { state: to },
  });
  return lines.length;
}
