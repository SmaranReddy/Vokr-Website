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
 * Paths that stay reachable on the origin's own hostname without the
 * Worker's header, because infrastructure outside Cloudflare calls them
 * directly:
 *
 *  - Cloud Run's **startup probe** (`deploy.yml`:
 *    `--startup-probe=httpGet.path=/api/health`). A 404 there fails the
 *    probe, so the revision never becomes ready and the deploy rolls
 *    back — verified against the production build locally before this
 *    exemption existed.
 *  - the pipeline's **smoke test**, which runs against the Cloud Run URL.
 *  - the **Cloud Scheduler keep-warm job**, which pings `/api/health`
 *    every 5 minutes (Phase 20 task 4.1).
 *
 * `/api/health` returns only `{"status":"ok"|"error"}` — no customer
 * data and no identity — so this one open path leaks nothing. It does
 * touch Postgres, so it stays a load surface, bounded by
 * `max-instances=3`; re-pointing the keep-warm job at `vokr.shop` after
 * cutover (`cloud-run.md`) narrows it further.
 */
const ORIGIN_CHECK_EXEMPT_PATHS = new Set(["/api/health"]);

/**
 * True when the request may proceed: it targets an exempt path, or no
 * origin secret is configured (local/dev/preview — there is no Worker in
 * front and nothing to check against), or it carries exactly the
 * configured secret. A falsy `configuredSecret` always short-circuits to
 * `true` rather than being compared — an unset app-side secret must
 * never be satisfied by an unset/empty request header.
 */
export function isOriginAuthorized(
  request: Request,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) {
    return true;
  }
  if (ORIGIN_CHECK_EXEMPT_PATHS.has(new URL(request.url).pathname)) {
    return true;
  }
  return request.headers.get(ORIGIN_AUTH_HEADER) === configuredSecret;
}
