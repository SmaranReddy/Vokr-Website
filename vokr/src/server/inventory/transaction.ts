import type { Prisma } from "@/generated/prisma/client";
import { getCheckoutDb } from "@/server/db/checkout-db";

import { isTransientTransactionError } from "./transient";

export { isTransientTransactionError };

export const LOCK_TIMEOUT = "5s";
export const TRANSACTION_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

/**
 * Runs `body` in one interactive transaction on the checkout connection,
 * with a bounded wait for row locks, retrying only transient failures.
 * No network call may happen inside `body` — the transaction holds row
 * locks for its whole duration (R9).
 */
export async function runLockingTransaction<T>(
  label: string,
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const db = getCheckoutDb();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
          return body(tx);
        },
        { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransientTransactionError(error)) throw error;
      console.warn(`[inventory] ${label} transient failure, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 30)));
    }
  }
}
