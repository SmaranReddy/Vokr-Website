/**
 * Cross-site request refusal for the API (plan §5 Phase 16, task 3).
 *
 * Session cookies are already `SameSite=Lax` (the guest cookie and
 * `@supabase/ssr`'s defaults), so a browser does not attach them to a
 * cross-site POST. This is the second layer the plan asks for: a
 * state-changing request to `/api/*` whose `Origin` is not this site — or
 * that a browser itself labels `Sec-Fetch-Site: cross-site` — is refused
 * before any route handler runs.
 *
 * - Compared against the configured site origin (`NEXT_PUBLIC_SITE_URL`),
 *   never `request.url`: behind Cloud Run that is the server's own bind
 *   address (see `redirect.ts`).
 * - A request with no `Origin` passes: browsers always send one on a
 *   non-GET request, so its absence means a non-browser client, which
 *   CSRF does not concern.
 * - Exempt: endpoints called server-to-server and authenticated by their
 *   own signature or token, never by a cookie — the Razorpay webhook (HMAC)
 *   and the maintenance job (Cloud Scheduler OIDC) — and `/api/csp-report`,
 *   which only logs and holds no cookie-authenticated state.
 * - Pages are out of scope: Next.js server actions carry their own origin
 *   check, and pages are only read with GET.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_SITE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/api/webhooks/razorpay",
  "/api/jobs/maintenance",
  // Log-only CSP violation reports, sent by browsers themselves.
  "/api/csp-report",
]);

export type CrossSiteCheck = "allowed" | "refused";

export function checkCrossSite(
  request: { method: string; headers: Headers; nextUrl: { pathname: string } },
  siteOrigin: string,
): CrossSiteCheck {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return "allowed";
  const path = request.nextUrl.pathname;
  if (!path.startsWith("/api/")) return "allowed";
  if (CROSS_SITE_EXEMPT_PATHS.has(path)) return "allowed";

  const origin = request.headers.get("origin");
  if (origin !== null) return origin === siteOrigin ? "allowed" : "refused";
  return request.headers.get("sec-fetch-site") === "cross-site" ? "refused" : "allowed";
}

/** The site's origin (`https://vokr.shop`) from the configured site URL, or `null` when it is not a valid URL. */
export function siteOriginFrom(siteUrl: string): string | null {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}
