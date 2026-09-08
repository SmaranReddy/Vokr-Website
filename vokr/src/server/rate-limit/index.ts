import { RateLimitError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

export interface RateLimitConfig {
  /** Unique per limited action + identifier, e.g. `auth:signin:ip:1.2.3.4`. */
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

interface RateLimitRow {
  count: number;
  window_start: Date;
}

/**
 * Postgres-backed fixed-window rate limiting (ADR-006 — no Redis at
 * launch). A single `INSERT ... ON CONFLICT` both reads and advances the
 * counter: if the existing window has expired it resets to 1, otherwise
 * it increments. Because it is one statement, Postgres's row-level lock
 * during the `ON CONFLICT` update makes two concurrent requests for the
 * same key serialize rather than race a read-then-write pair past the
 * limit.
 */
export async function consumeRateLimit({
  key,
  limit,
  windowMs,
}: RateLimitConfig): Promise<RateLimitResult> {
  // Millisecond-precision interval math — a `Math.ceil(windowMs / 1000)`
  // second-rounding here would silently inflate any sub-second or
  // non-whole-second window (e.g. 200ms becomes a full 1000ms window),
  // which a test caught directly.
  const windowMillis = Math.max(1, Math.round(windowMs));

  const rows = await prisma.$queryRaw<RateLimitRow[]>`
    INSERT INTO rate_limit_counters (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limit_counters.window_start <= now() - (interval '1 millisecond' * ${windowMillis})
          THEN 1
        ELSE rate_limit_counters.count + 1
      END,
      window_start = CASE
        WHEN rate_limit_counters.window_start <= now() - (interval '1 millisecond' * ${windowMillis})
          THEN now()
        ELSE rate_limit_counters.window_start
      END
    RETURNING count, window_start;
  `;

  const row = rows[0];
  if (!row) {
    // Unreachable in practice — RETURNING on an upsert always yields the
    // one row it just wrote or updated. Guarded because $queryRaw's type
    // is an array, not a guaranteed-nonempty tuple.
    throw new Error("consumeRateLimit: upsert returned no row");
  }

  const allowed = row.count <= limit;
  const resetAt = new Date(row.window_start.getTime() + windowMs);
  return { allowed, remaining: Math.max(0, limit - row.count), resetAt };
}

/** Throws {@link RateLimitError} once the window's limit is exceeded. */
export async function assertWithinRateLimit(
  config: RateLimitConfig,
): Promise<void> {
  const result = await consumeRateLimit(config);
  if (!result.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded. Try again after ${result.resetAt.toISOString()}.`,
    );
  }
}
