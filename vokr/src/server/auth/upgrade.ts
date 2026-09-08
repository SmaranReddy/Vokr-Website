import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The client type Prisma passes into an interactive `$transaction`
 * callback — every model delegate, minus the connection-lifecycle and
 * client-extension methods that make no sense mid-transaction.
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export interface GuestUpgradeContext {
  guestSessionId: string;
  userId: string;
  /** Runs inside the same transaction that deletes the guest session row. */
  tx: TransactionClient;
}

export type GuestUpgradeHandler = (
  context: GuestUpgradeContext,
) => Promise<void>;

const handlers: GuestUpgradeHandler[] = [];

/**
 * Registers a handler to run whenever a guest identified by
 * `guestSessionId` signs in as `userId` — inside the same database
 * transaction as the guest session's deletion, so a handler's effect and
 * the identity transition either both land or neither does. Phase 5
 * registers the cart merge here; Phase 3 only builds the mechanism (plan
 * §5 Phase 3, task 7).
 *
 * Handlers must be idempotent: a retried sign-in request must not
 * double-apply a handler's effect (e.g. double cart quantities).
 */
export function registerGuestUpgradeHandler(
  handler: GuestUpgradeHandler,
): void {
  handlers.push(handler);
}

/** Test-only: clears the registry so test files don't leak handlers into each other. */
export function __resetGuestUpgradeHandlersForTests(): void {
  handlers.length = 0;
}

export async function runGuestUpgradeHandlers(
  context: GuestUpgradeContext,
): Promise<void> {
  for (const handler of handlers) {
    await handler(context);
  }
}
