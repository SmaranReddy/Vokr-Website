import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  GUEST_COOKIE_NAME,
  getOrCreateGuestSession,
  invalidateGuestSession,
} from "@/server/auth/guest";
import { hashGuestToken } from "@/server/auth/tokens";
import { prisma } from "@/server/db/client";

/**
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`, never as part of `npm run test`.
 *
 * Cleanup is scoped to the exact rows this file creates (tracked in
 * `createdIds`), not a table-wide `deleteMany({})` — `app-user` and
 * `complete-sign-in`'s integration suites touch this same
 * `guest_sessions` table and run concurrently with this file, so a
 * blanket delete here would race their in-flight assertions.
 */

const createdIds: string[] = [];

async function trackedGetOrCreateGuestSession(rawToken: string | undefined) {
  const result = await getOrCreateGuestSession(rawToken);
  createdIds.push(result.guestSessionId);
  return result;
}

afterEach(async () => {
  await prisma.guestSession.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("guest sessions (Phase 3)", () => {
  it("creates a row whose token_hash matches the issued cookie value, never the raw token", async () => {
    const result = await trackedGetOrCreateGuestSession(undefined);
    expect(result.setCookie?.name).toBe(GUEST_COOKIE_NAME);

    const row = await prisma.guestSession.findUniqueOrThrow({
      where: { id: result.guestSessionId },
    });
    expect(row.tokenHash).toBe(hashGuestToken(result.setCookie!.value));
    expect(row.tokenHash).not.toBe(result.setCookie!.value);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reuses a live session and bumps last_seen_at without minting a new cookie", async () => {
    const created = await trackedGetOrCreateGuestSession(undefined);
    const before = await prisma.guestSession.findUniqueOrThrow({
      where: { id: created.guestSessionId },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const resolved = await trackedGetOrCreateGuestSession(
      created.setCookie!.value,
    );

    expect(resolved.guestSessionId).toBe(created.guestSessionId);
    expect(resolved.setCookie).toBeUndefined();

    const after = await prisma.guestSession.findUniqueOrThrow({
      where: { id: created.guestSessionId },
    });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(
      before.lastSeenAt.getTime(),
    );
  });

  it("mints a fresh session, leaving the stale row in place, when the presented token has expired", async () => {
    const created = await trackedGetOrCreateGuestSession(undefined);
    const row = await prisma.guestSession.findUniqueOrThrow({
      where: { id: created.guestSessionId },
    });
    // Just after created_at (satisfying the CHECK constraint below) but
    // already in the past by the time the next call runs.
    await prisma.guestSession.update({
      where: { id: created.guestSessionId },
      data: { expiresAt: new Date(row.createdAt.getTime() + 1) },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const resolved = await trackedGetOrCreateGuestSession(
      created.setCookie!.value,
    );

    expect(resolved.guestSessionId).not.toBe(created.guestSessionId);
    expect(resolved.setCookie).toBeDefined();
    // The expired row is left for the Phase 17/18 pruning job to collect —
    // identity resolution is not responsible for cleanup.
    await expect(
      prisma.guestSession.findUniqueOrThrow({
        where: { id: created.guestSessionId },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects a token_hash collision (UNIQUE constraint)", async () => {
    const first = await trackedGetOrCreateGuestSession(undefined);
    const row = await prisma.guestSession.findUniqueOrThrow({
      where: { id: first.guestSessionId },
    });

    await expect(
      prisma.guestSession.create({
        data: {
          tokenHash: row.tokenHash,
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("rejects expires_at at or before created_at (CHECK constraint)", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO guest_sessions (id, token_hash, expires_at)
        VALUES (gen_random_uuid(), 'test-hash-invalid-expiry', now() - interval '1 second')`,
    ).rejects.toThrow(/guest_sessions_expires_after_created/);
  });

  it("invalidateGuestSession deletes the row and is idempotent", async () => {
    const created = await trackedGetOrCreateGuestSession(undefined);

    await invalidateGuestSession(created.guestSessionId);
    await expect(
      prisma.guestSession.findUnique({ where: { id: created.guestSessionId } }),
    ).resolves.toBeNull();

    await expect(
      invalidateGuestSession(created.guestSessionId),
    ).resolves.toBeUndefined();
  });

  it("has Row Level Security enabled on app_users, guest_sessions and rate_limit_counters", async () => {
    const rows = await prisma.$queryRaw<
      { relname: string; relrowsecurity: boolean }[]
    >`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('app_users', 'guest_sessions', 'rate_limit_counters')
    `;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(
        true,
      );
    }
  });
});
