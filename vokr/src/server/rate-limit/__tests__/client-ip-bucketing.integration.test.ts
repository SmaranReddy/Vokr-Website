import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { consumeRateLimit } from "@/server/rate-limit";
import { getClientIp } from "@/server/net/client-ip";
import { VERIFIED_ORIGIN_HEADER } from "@/server/net/origin-auth";
import { prisma } from "@/server/db/client";

/**
 * R13's second half — the one the plan records as never having been
 * tested: *"a test showing per-IP not per-instance limiting"* (§6, R13
 * row).
 *
 * The risk R13 names is specific and comes from the PDF: when Auth is
 * called server-side, "every customer shares Cloud Run's egress IP and
 * one bucket". A limiter that keyed on the *socket* peer would therefore
 * put the entire customer base into a single bucket and throttle
 * everyone the moment one visitor was noisy. The defence is that this
 * app's own limiter keys on the **forwarded client IP**, resolved by
 * `getClientIp()` from `cf-connecting-ip` / `x-forwarded-for`.
 *
 * Two independent properties have to hold, and a test that only checks
 * one proves nothing about the other:
 *
 *  1. **Per-IP** — two different client IPs occupy independent buckets,
 *     so one exhausting its allowance never blocks the other.
 *  2. **Not per-instance** — the counter lives in shared Postgres, not
 *     in a process's memory, so N Cloud Run instances enforce one
 *     combined allowance rather than N separate ones. An in-memory
 *     limiter would silently multiply every limit by the instance count.
 *
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`.
 */

/** The key shape the auth routes build: `auth:<action>:ip:<resolved ip>`. */
function ipKey(action: string, request: Request): string {
  return `auth:${action}:ip:${getClientIp(request)}`;
}

// D9 (ADR-031): `getClientIp` now trusts these headers only once the
// request has passed the Worker's origin check (`src/proxy.ts` stamps
// this) — see `src/server/net/__tests__/origin-auth.test.ts` for that
// gate itself. Every request built here stands in for one that already
// passed it, so the forwarded-IP headers below are the thing under test.
function requestFrom(headers: Record<string, string>): Request {
  return new Request("https://vokr.shop/api/auth/signin", {
    headers: { ...headers, [VERIFIED_ORIGIN_HEADER]: "1" },
  });
}

/** Row ids this file created, so cleanup never deletes another file's rows. */
const createdKeys: string[] = [];

function trackKey(key: string): string {
  createdKeys.push(key);
  return key;
}

afterEach(async () => {
  if (createdKeys.length > 0) {
    await prisma.rateLimitCounter.deleteMany({
      where: { key: { in: createdKeys } },
    });
    createdKeys.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("R13 — limiting is per client IP, not per server instance", () => {
  it("puts two different forwarded client IPs in independent buckets", async () => {
    const action = `test-${randomUUID()}`;

    // Both requests arrive at the same server process, over the same
    // egress path — exactly the Cloud Run shape R13 warns about. Only the
    // forwarded header differs.
    const noisy = requestFrom({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" });
    const quiet = requestFrom({ "x-forwarded-for": "198.51.100.20, 10.0.0.1" });

    const noisyKey = trackKey(ipKey(action, noisy));
    const quietKey = trackKey(ipKey(action, quiet));

    expect(noisyKey).not.toBe(quietKey);

    // Exhaust the noisy visitor's allowance completely.
    for (let i = 0; i < 3; i += 1) {
      await consumeRateLimit({ key: noisyKey, limit: 3, windowMs: 60_000 });
    }
    const noisyBlocked = await consumeRateLimit({
      key: noisyKey,
      limit: 3,
      windowMs: 60_000,
    });
    expect(noisyBlocked.allowed).toBe(false);

    // The second visitor must be untouched. If the limiter keyed on the
    // shared egress IP (or on nothing at all), this would already be
    // blocked — which is the whole failure R13 describes.
    const quietFirst = await consumeRateLimit({
      key: quietKey,
      limit: 3,
      windowMs: 60_000,
    });
    expect(quietFirst.allowed).toBe(true);
    expect(quietFirst.remaining).toBe(2);
  });

  it("prefers cf-connecting-ip, so a spoofed x-forwarded-for cannot borrow another visitor's bucket behind Cloudflare", async () => {
    const action = `test-${randomUUID()}`;

    // Cloudflare sets `cf-connecting-ip` itself and it is the header the
    // resolver trusts first. A client-supplied `x-forwarded-for` claiming
    // to be someone else must not change which bucket is used.
    const genuine = requestFrom({ "cf-connecting-ip": "203.0.113.30" });
    const spoofing = requestFrom({
      "cf-connecting-ip": "203.0.113.30",
      "x-forwarded-for": "198.51.100.40",
    });

    expect(ipKey(action, spoofing)).toBe(ipKey(action, genuine));

    const key = trackKey(ipKey(action, genuine));
    await consumeRateLimit({ key, limit: 1, windowMs: 60_000 });

    const second = await consumeRateLimit({
      key: trackKey(ipKey(action, spoofing)),
      limit: 1,
      windowMs: 60_000,
    });
    expect(second.allowed).toBe(false);
  });

  it("shares one counter across independent connections, so N instances do not each get a full allowance", async () => {
    const action = `test-${randomUUID()}`;
    const request = requestFrom({ "cf-connecting-ip": "203.0.113.50" });
    const key = trackKey(ipKey(action, request));

    // "Instance A" — the app's own singleton client.
    for (let i = 0; i < 5; i += 1) {
      await consumeRateLimit({ key, limit: 5, windowMs: 60_000 });
    }

    // "Instance B" — a genuinely separate PrismaClient with its own
    // connection pool, standing in for a second Cloud Run instance. It
    // must observe the counter Instance A advanced. A per-instance
    // in-memory limiter would show nothing here, and instance B would
    // hand out another full allowance of 5.
    const connectionString = process.env["DATABASE_URL"];
    expect(connectionString, "DATABASE_URL must be set").toBeTruthy();

    const instanceB = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
      log: ["error"],
    });

    try {
      const seenByB = await instanceB.rateLimitCounter.findUnique({
        where: { key },
        select: { count: true },
      });

      expect(seenByB).not.toBeNull();
      expect(seenByB?.count).toBe(5);
    } finally {
      await instanceB.$disconnect();
    }

    // And the shared row is what the allow/deny decision reads, so the
    // next request — whichever instance serves it — is refused.
    const next = await consumeRateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(next.allowed).toBe(false);
  });
});

/**
 * The behavioural tests above prove the limiter honours whatever key it
 * is given. This one pins the other half: that the auth routes actually
 * derive that key from the forwarded client IP rather than from a
 * constant. Without it, the routes could regress to a fixed key and
 * every test above would still pass.
 *
 * Asserted on source text for the same reason as
 * `src/lib/__tests__/env-client-inlining.test.ts`: the route modules live
 * under `src/app/**`, which the Vitest `node` project does not load.
 */
const IP_LIMITED_ROUTES = [
  { route: "signin", file: "../../../app/api/auth/signin/route.ts" },
  { route: "signup", file: "../../../app/api/auth/signup/route.ts" },
  { route: "reset", file: "../../../app/api/auth/reset/route.ts" },
] as const;

describe("R13 — every rate-limited auth route keys on the resolved client IP", () => {
  for (const { route, file } of IP_LIMITED_ROUTES) {
    it(`/api/auth/${route} resolves the client IP and keys its IP bucket on it`, () => {
      const source = readFileSync(
        path.resolve(import.meta.dirname, file),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "");

      expect(source).toContain("getClientIp(request)");

      // The interpolated key must carry the resolved IP, not a literal.
      expect(source).toMatch(
        new RegExp(`key:\\s*\`auth:${route}:ip:\\$\\{ip\\}\``),
      );
    });
  }
});
