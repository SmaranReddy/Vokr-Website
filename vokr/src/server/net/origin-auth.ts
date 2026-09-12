/**
 * The origin-auth contract between the Cloudflare Worker
 * (`vokr/infra/cloudflare/edge-worker.mjs`) and this application — D9,
 * ADR-031. The Worker stamps every request it forwards with the shared
 * secret under `ORIGIN_AUTH_HEADER`; this file is the only place on the
 * application side that reads it, so the two ends can never drift on the
 * header name.
 */
export const ORIGIN_AUTH_HEADER = "x-vokr-origin-auth";

/**
 * Set on the request as it continues past `src/proxy.ts`, once the
 * Worker's secret has been checked — the only signal
 * `src/server/net/client-ip.ts` trusts before relying on
 * `cf-connecting-ip` / `x-forwarded-for` (R13: those headers are
 * attacker-controlled on any request that reaches Cloud Run directly).
 */
export const VERIFIED_ORIGIN_HEADER = "x-vokr-verified-origin";

/**
 * True when either no origin secret is configured (local/dev/preview —
 * there is no Worker in front and nothing to check against) or the
 * request carries exactly the configured secret. A falsy
 * `configuredSecret` always short-circuits to `true` rather than being
 * compared — an unset app-side secret must never be satisfied by an
 * unset/empty request header.
 */
export function isOriginAuthorized(
  request: Request,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) {
    return true;
  }
  return request.headers.get(ORIGIN_AUTH_HEADER) === configuredSecret;
}
