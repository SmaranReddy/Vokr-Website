import { CheckoutState } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

/**
 * `draft → address_captured → priced → reserved → payment_pending →
 * paid | failed | expired | abandoned` (plan §5 Phase 6, task 8). Phase 6
 * only ever drives a session through `draft` → `address_captured` →
 * `priced`; `reserved` (Phase 8) and `payment_pending`/`paid`/`failed`
 * (Phase 7) are reached by later phases reusing this same table.
 *
 * A session can be abandoned or expired from any non-terminal state — a
 * customer can close the tab at any point before payment completes.
 * `paid` and `failed` are terminal: nothing transitions out of them.
 */
const TRANSITIONS: Readonly<Record<CheckoutState, readonly CheckoutState[]>> = {
  [CheckoutState.draft]: [
    CheckoutState.address_captured,
    CheckoutState.abandoned,
    CheckoutState.expired,
  ],
  [CheckoutState.address_captured]: [
    CheckoutState.priced,
    CheckoutState.abandoned,
    CheckoutState.expired,
  ],
  [CheckoutState.priced]: [
    CheckoutState.reserved,
    CheckoutState.abandoned,
    CheckoutState.expired,
  ],
  [CheckoutState.reserved]: [CheckoutState.payment_pending, CheckoutState.expired],
  [CheckoutState.payment_pending]: [
    CheckoutState.paid,
    CheckoutState.failed,
    CheckoutState.expired,
  ],
  [CheckoutState.paid]: [],
  [CheckoutState.failed]: [],
  [CheckoutState.expired]: [],
  [CheckoutState.abandoned]: [],
};

export function isValidCheckoutTransition(
  from: CheckoutState,
  to: CheckoutState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Throws {@link ConflictError} for an illegal transition (plan §5 Phase 6,
 * task 8: "Illegal transitions throw"). Also logs every attempted
 * transition — legal or not — to stdout/stderr as the append-only record
 * task 8 requires; Phase 6 does not add a dedicated database table for
 * this (the `audit_log` table, plan §3.5, is scoped to orders and
 * payments only at launch).
 */
export function assertValidCheckoutTransition(
  sessionId: string,
  from: CheckoutState,
  to: CheckoutState,
): void {
  const allowed = isValidCheckoutTransition(from, to);
  if (allowed) {
    console.info(
      `[checkout] session=${sessionId} transition ${from} -> ${to}`,
    );
    return;
  }

  console.warn(
    `[checkout] session=${sessionId} REJECTED illegal transition ${from} -> ${to}`,
  );
  throw new ConflictError(
    `Checkout session cannot move from "${from}" to "${to}".`,
  );
}
