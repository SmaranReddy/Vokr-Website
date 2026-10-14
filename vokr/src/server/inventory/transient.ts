/**
 * SQLSTATEs that mean "nothing was written; running the same transaction
 * again is safe": deadlock, serialization failure, and `lock_timeout`
 * expiring while waiting for a row lock. Every locking transaction in this
 * module either commits completely or not at all, and re-reads its state
 * under the lock, so a retry can never apply a change twice.
 */
const TRANSIENT_SQLSTATES = new Set(["40P01", "40001", "55P03"]);

/** Prisma's own code for "write conflict or deadlock" in an interactive transaction. */
const TRANSIENT_PRISMA_CODES = new Set(["P2034"]);

/**
 * Prisma surfaces a Postgres error differently depending on the call
 * (`$queryRaw` vs a model method) and on the driver adapter, so the
 * SQLSTATE is looked for wherever it may be: the error's own `code`, its
 * `meta`, its `cause` chain, or the `Code: \`40P01\`` text Prisma puts in
 * the message.
 */
export function isTransientTransactionError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const candidate = error as {
    code?: unknown;
    meta?: unknown;
    cause?: unknown;
    message?: unknown;
    originalCode?: unknown;
  };
  for (const code of [candidate.code, candidate.originalCode]) {
    if (typeof code === "string" && (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_PRISMA_CODES.has(code))) {
      return true;
    }
  }
  if (typeof candidate.message === "string") {
    for (const state of TRANSIENT_SQLSTATES) {
      if (candidate.message.includes(state)) return true;
    }
    if (/deadlock detected|could not serialize|lock timeout/i.test(candidate.message)) return true;
  }
  if (candidate.meta && typeof candidate.meta === "object") {
    for (const value of Object.values(candidate.meta)) {
      if (isTransientTransactionError(value, depth + 1)) return true;
      if (typeof value === "string" && TRANSIENT_SQLSTATES.has(value)) return true;
    }
  }
  return isTransientTransactionError(candidate.cause, depth + 1);
}
