import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * Verifies the OIDC ID token Cloud Scheduler attaches to job 3's request
 * (plan §5 Phase 8, task 7: "authenticated by an OIDC token from the
 * scheduler's service account — never a shared bearer secret").
 *
 * The Cloud Run service is `--allow-unauthenticated` (the storefront is
 * public), so Cloud Run does not check the token; this does. Only Google's
 * RS256 signature over a token issued *to* the configured audience *for*
 * the configured service account is accepted. Implemented on
 * `node:crypto` rather than a JWT library: the token format is fixed and
 * the checks are few, and each one is visible here.
 */

export const GOOGLE_ISSUERS: ReadonlySet<string> = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Allowed clock difference between Google and this instance. */
const CLOCK_SKEW_SECONDS = 60;
/** Google ID tokens live one hour; anything claiming longer is not one. */
const MAX_LIFETIME_SECONDS = 3600 + CLOCK_SKEW_SECONDS;
/** A Google ID token is ~1 KB; refuse to parse anything far larger. */
const MAX_TOKEN_LENGTH = 4096;

export interface OidcExpectation {
  audience: string;
  serviceAccountEmail: string;
}

/** Looks a signing key up by `kid`; `null` when the key is not (or no longer) published. */
export type KeyResolver = (kid: string) => Promise<JsonWebKey | null>;

export type OidcResult = { ok: true; email: string } | { ok: false; reason: string };

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export async function verifyGoogleOidcToken(
  token: string,
  expected: OidcExpectation,
  resolveKey: KeyResolver,
  nowMs: number = Date.now(),
): Promise<OidcResult> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) {
    return { ok: false, reason: "malformed" };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  let header: { alg?: unknown; kid?: unknown };
  let claims: {
    iss?: unknown;
    aud?: unknown;
    email?: unknown;
    email_verified?: unknown;
    exp?: unknown;
    iat?: unknown;
  };
  try {
    header = decodeSegment(headerSegment) as typeof header;
    claims = decodeSegment(payloadSegment) as typeof claims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") {
    return { ok: false, reason: "malformed" };
  }

  // RS256 only. `none`, HS256 (a public key misused as an HMAC secret) and
  // every other algorithm are refused before any key is looked up.
  if (header.alg !== "RS256") return { ok: false, reason: "algorithm" };
  if (typeof header.kid !== "string" || header.kid.length === 0) return { ok: false, reason: "kid" };

  const jwk = await resolveKey(header.kid);
  if (!jwk || jwk.kty !== "RSA") return { ok: false, reason: "unknown_key" };

  let signatureValid = false;
  try {
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${headerSegment}.${payloadSegment}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signatureSegment, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: "signature" };

  const now = Math.floor(nowMs / 1000);
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: "issuer" };
  if (claims.aud !== expected.audience) return { ok: false, reason: "audience" };
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") return { ok: false, reason: "times" };
  if (claims.exp + CLOCK_SKEW_SECONDS <= now) return { ok: false, reason: "expired" };
  if (claims.iat - CLOCK_SKEW_SECONDS > now) return { ok: false, reason: "not_yet_valid" };
  if (claims.exp - claims.iat > MAX_LIFETIME_SECONDS) return { ok: false, reason: "lifetime" };
  if (
    typeof claims.email !== "string" ||
    claims.email.toLowerCase() !== expected.serviceAccountEmail.toLowerCase() ||
    claims.email_verified !== true
  ) {
    return { ok: false, reason: "subject" };
  }
  return { ok: true, email: claims.email };
}

/**
 * Google's published signing keys, cached for the `max-age` Google sends
 * (an hour, typically). An unknown `kid`, an expired cache or a failed
 * fetch triggers at most one refetch a minute, so a stream of forged
 * tokens cannot turn into a stream of requests to Google.
 */
export function createGoogleKeyResolver(fetchImpl: typeof fetch = fetch): KeyResolver {
  let keys = new Map<string, JsonWebKey>();
  let expiresAtMs = 0;
  let lastFetchMs = 0;

  async function refresh(nowMs: number): Promise<void> {
    lastFetchMs = nowMs;
    const response = await fetchImpl(GOOGLE_CERTS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Google certs fetch failed: HTTP ${response.status}`);
    const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    keys = new Map(
      (body.keys ?? [])
        .filter((key): key is JsonWebKey & { kid: string } => typeof key.kid === "string")
        .map((key) => [key.kid, key]),
    );
    const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1];
    expiresAtMs = nowMs + Math.min(Number(maxAge ?? 3600), 24 * 3600) * 1000;
  }

  return async (kid) => {
    const nowMs = Date.now();
    const stale = nowMs >= expiresAtMs || !keys.has(kid);
    if (stale && (lastFetchMs === 0 || nowMs - lastFetchMs >= 60_000)) {
      await refresh(nowMs);
    }
    return keys.get(kid) ?? null;
  };
}
