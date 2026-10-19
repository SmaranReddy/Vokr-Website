import { createHmac, generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { handleMaintenanceRequest } from "../handler";
import type { MaintenanceReport } from "../maintenance";
import { createGoogleKeyResolver, verifyGoogleOidcToken, type KeyResolver } from "../oidc";

/**
 * Phase 8 Security Requirements: "The maintenance endpoint authenticates
 * the Cloud Scheduler service account via OIDC." Tokens are signed with a
 * local RSA key standing in for Google's; nothing here calls Google.
 */

const AUDIENCE = "https://vokr.shop/api/jobs/maintenance";
const SCHEDULER = "vokr-scheduler@vokr-website.iam.gserviceaccount.com";
const EXPECTED = { audience: AUDIENCE, serviceAccountEmail: SCHEDULER };
const KID = "test-key-1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

const resolveKey: KeyResolver = async (kid) => (kid === KID ? publicJwk : null);

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
  overrides: { header?: Record<string, unknown>; claims?: Record<string, unknown>; key?: typeof privateKey } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KID, typ: "JWT", ...overrides.header };
  const claims = {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    email: SCHEDULER,
    email_verified: true,
    iat: now - 10,
    exp: now + 3590,
    sub: "1234567890",
    ...overrides.claims,
  };
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), overrides.key ?? privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

describe("verifyGoogleOidcToken", () => {
  it("accepts a token Google would issue to the scheduler for this audience", async () => {
    await expect(verifyGoogleOidcToken(token(), EXPECTED, resolveKey)).resolves.toEqual({
      ok: true,
      email: SCHEDULER,
    });
  });

  it.each([
    ["another audience", { claims: { aud: "https://vokr.shop" } }, "audience"],
    ["another service account", { claims: { email: "attacker@evil.iam.gserviceaccount.com" } }, "subject"],
    ["an unverified email", { claims: { email_verified: false } }, "subject"],
    ["another issuer", { claims: { iss: "https://evil.example" } }, "issuer"],
    ["an expired token", { claims: { iat: 1_000, exp: 2_000 } }, "expired"],
    ["a token from the future", { claims: { iat: Math.floor(Date.now() / 1000) + 600, exp: Math.floor(Date.now() / 1000) + 4000 } }, "not_yet_valid"],
    ["an over-long lifetime", { claims: { iat: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 86_400 } }, "lifetime"],
    ["a token signed by another key", { key: otherKeys.privateKey }, "signature"],
    ["an unknown key id", { header: { kid: "rotated-away" } }, "unknown_key"],
    ["alg none", { header: { alg: "none" } }, "algorithm"],
    ["HS256", { header: { alg: "HS256" } }, "algorithm"],
  ])("refuses %s", async (_label, overrides, reason) => {
    await expect(verifyGoogleOidcToken(token(overrides), EXPECTED, resolveKey)).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses an HS256 token MACed with the public key (algorithm confusion)", async () => {
    const signingInput = `${b64({ alg: "HS256", kid: KID })}.${b64({ iss: "https://accounts.google.com", aud: AUDIENCE, email: SCHEDULER, email_verified: true })}`;
    const mac = createHmac("sha256", JSON.stringify(publicJwk)).update(signingInput).digest("base64url");
    await expect(verifyGoogleOidcToken(`${signingInput}.${mac}`, EXPECTED, resolveKey)).resolves.toMatchObject({
      ok: false,
    });
  });

  it("refuses a tampered payload with the original signature", async () => {
    const [header, , signature] = token().split(".");
    const forged = b64({ iss: "https://accounts.google.com", aud: AUDIENCE, email: SCHEDULER, email_verified: true, iat: 0, exp: 9_999_999_999 });
    await expect(verifyGoogleOidcToken(`${header}.${forged}.${signature}`, EXPECTED, resolveKey)).resolves.toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it.each(["", "a.b", "a.b.c.d", "!!.@@.##", "x".repeat(5000)])("refuses malformed input %#", async (raw) => {
    await expect(verifyGoogleOidcToken(raw, EXPECTED, resolveKey)).resolves.toMatchObject({ ok: false });
  });
});

describe("createGoogleKeyResolver", () => {
  function certsResponse() {
    return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID }] }), {
      headers: { "cache-control": "public, max-age=3600" },
    });
  }

  it("caches Google's keys and does not refetch for every forged kid", async () => {
    const fetchImpl = vi.fn(async () => certsResponse());
    const resolver = createGoogleKeyResolver(fetchImpl as unknown as typeof fetch);

    expect(await resolver(KID)).toMatchObject({ kty: "RSA" });
    expect(await resolver(KID)).toMatchObject({ kty: "RSA" });
    for (let i = 0; i < 20; i += 1) expect(await resolver(`forged-${i}`)).toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("handleMaintenanceRequest", () => {
  const okReport: MaintenanceReport = {
    ok: true,
    reconciliation: { status: "not_configured" },
    expiry: {
      status: "ok",
      result: {
        examined: 0,
        errors: 0,
        outcomes: {
          expired: 0,
          kept_payment_in_progress: 0,
          kept_attempt_unfinished: 0,
          kept_in_payment_grace: 0,
          kept_unverified: 0,
          nothing_to_do: 0,
        },
      },
    },
    latePayments: { status: "not_configured" },
    orders: { status: "ok", result: { paidSessionsWithoutOrder: 0, capturedPaymentsUnaccounted: 0, ordersWithoutCapture: 0 } },
    emails: { status: "not_configured" },
    pruning: { status: "ok", result: { rateLimitCounters: 0, webhookEvents: 0, reservations: 0, emailLog: 0 } },
    retention: {
      status: "ok",
      result: {
        mode: "report",
        guestSessionsPastRetention: 0,
        abandonedCartsPastRetention: 0,
        checkoutContactEmailsPastRetention: 0,
        auditLogOlderThanOneYear: 0,
        consentRecordsPastRetention: 0,
        checkoutContactEmailsCleared: 0,
      },
    },
  };

  it("runs the job for the scheduler's token", async () => {
    const run = vi.fn(async () => okReport);
    const result = await handleMaintenanceRequest({
      authorization: `Bearer ${token()}`,
      expected: EXPECTED,
      resolveKey,
      run,
    });
    expect(result.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is a 503 that runs nothing when the audience / service account are not configured", async () => {
    const run = vi.fn(async () => okReport);
    const result = await handleMaintenanceRequest({
      authorization: `Bearer ${token()}`,
      expected: undefined,
      resolveKey,
      run,
    });
    expect(result).toEqual({ status: 503, body: { ok: false, error: "not_configured" } });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", null],
    ["a non-bearer scheme", `Basic ${Buffer.from("a:b").toString("base64")}`],
    ["a shared-secret style bearer", "Bearer hunter2"],
    ["another audience's token", `Bearer ${token({ claims: { aud: "https://other.example" } })}`],
  ])("refuses %s with one uniform 401 and runs nothing", async (_label, authorization) => {
    const run = vi.fn(async () => okReport);
    const result = await handleMaintenanceRequest({ authorization, expected: EXPECTED, resolveKey, run });
    expect(result).toEqual({ status: 401, body: { ok: false, error: "unauthorized" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a failed step as 500 so Cloud Scheduler retries", async () => {
    const result = await handleMaintenanceRequest({
      authorization: `Bearer ${token()}`,
      expected: EXPECTED,
      resolveKey,
      run: async () => ({ ...okReport, ok: false, pruning: { status: "error" } }),
    });
    expect(result.status).toBe(500);
  });
});
