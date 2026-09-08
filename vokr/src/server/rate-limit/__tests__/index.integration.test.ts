import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { RateLimitError } from "@/lib/errors";
import { assertWithinRateLimit, consumeRateLimit } from "@/server/rate-limit";
import { prisma } from "@/server/db/client";

/**
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`.
 */

afterEach(async () => {
  await prisma.rateLimitCounter.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("consumeRateLimit (Phase 3, task 11)", () => {
  it("allows requests up to the limit and blocks the one after", async () => {
    const key = `test:${randomUUID()}`;

    for (let i = 1; i <= 3; i += 1) {
      const result = await consumeRateLimit({
        key,
        limit: 3,
        windowMs: 60_000,
      });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - i);
    }

    const blocked = await consumeRateLimit({ key, limit: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets the window once it has elapsed and recovers", async () => {
    const key = `test:${randomUUID()}`;

    await consumeRateLimit({ key, limit: 1, windowMs: 200 });
    const blocked = await consumeRateLimit({ key, limit: 1, windowMs: 200 });
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const afterReset = await consumeRateLimit({ key, limit: 1, windowMs: 200 });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
  });

  it("serializes concurrent requests against the same key rather than racing past the limit", async () => {
    const key = `test:${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit({ key, limit: 5, windowMs: 60_000 }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
  });

  it("keeps independent keys in independent buckets", async () => {
    const keyA = `test:${randomUUID()}`;
    const keyB = `test:${randomUUID()}`;

    await consumeRateLimit({ key: keyA, limit: 1, windowMs: 60_000 });
    const resultB = await consumeRateLimit({
      key: keyB,
      limit: 1,
      windowMs: 60_000,
    });

    expect(resultB.allowed).toBe(true);
  });
});

describe("assertWithinRateLimit", () => {
  it("throws RateLimitError once the window's limit is exceeded", async () => {
    const key = `test:${randomUUID()}`;

    await assertWithinRateLimit({ key, limit: 1, windowMs: 60_000 });
    await expect(
      assertWithinRateLimit({ key, limit: 1, windowMs: 60_000 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("rate_limit_counters table", () => {
  it("has Row Level Security enabled", async () => {
    const rows = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'rate_limit_counters'
    `;
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("rejects a negative count (CHECK constraint)", async () => {
    await expect(
      prisma.$executeRaw`INSERT INTO rate_limit_counters (key, window_start, count)
        VALUES ('test-negative-count', now(), -1)`,
    ).rejects.toThrow(/rate_limit_counters_count_non_negative/);
  });
});
