import { PrismaPg } from "@prisma/adapter-pg";

import { requireServerEnv } from "@/lib/env";
import { PrismaClient } from "@/generated/prisma/client";

import { prisma } from "./client";

/**
 * The connection the Phase 8 locking transactions run on (plan §5 Phase 8,
 * task 2: "the direct/session connection, not the transaction-mode
 * pooler").
 *
 * A second pool is only opened when `DIRECT_URL` is set *and* differs from
 * `DATABASE_URL`. Otherwise — local development, and production today,
 * whose `DATABASE_URL` is already Supabase's session pooler — the shared
 * client is reused, so an instance never holds two pools against
 * Supabase's connection limit for no gain. Built lazily, on the first
 * checkout transaction, never at module load.
 */

const globalForCheckoutDb = globalThis as unknown as {
  checkoutDbClient: PrismaClient | undefined;
};

export function getCheckoutDb(): PrismaClient {
  if (globalForCheckoutDb.checkoutDbClient) {
    return globalForCheckoutDb.checkoutDbClient;
  }

  const { DATABASE_URL, DIRECT_URL, NODE_ENV } = requireServerEnv();
  const client =
    DIRECT_URL && DIRECT_URL !== DATABASE_URL
      ? new PrismaClient({
          adapter: new PrismaPg({ connectionString: DIRECT_URL }),
          log: NODE_ENV === "development" ? ["warn", "error"] : ["error"],
        })
      : prisma;

  globalForCheckoutDb.checkoutDbClient = client;
  return client;
}
