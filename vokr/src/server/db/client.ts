import { PrismaPg } from "@prisma/adapter-pg";

import { requireServerEnv } from "@/lib/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single `PrismaClient` instance for the whole process, guarded against
 * the dev-mode duplication that `next dev`'s module reloading would
 * otherwise cause (each reload would otherwise open a fresh connection
 * pool without closing the last one).
 *
 * Query logging is development-only — production logs go to Cloud
 * Logging (Phase 15), never `console`, and never include query
 * parameters (which can carry PII).
 */

const globalForPrisma = globalThis as unknown as {
  prismaClient: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const { DATABASE_URL, NODE_ENV } = requireServerEnv();
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and point " +
        "it at a running Postgres instance (see docker-compose.yml for " +
        "local development).",
    );
  }

  const adapter = new PrismaPg({ connectionString: DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaClient = prisma;
}
