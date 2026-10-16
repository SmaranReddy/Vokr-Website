/**
 * One identifier per request (plan §5 Phase 15, task 5), assigned in
 * `src/proxy.ts`, forwarded to route handlers in {@link REQUEST_ID_HEADER},
 * returned to the client as `x-request-id`, and used as the `requestId` in
 * error bodies and server error logs — so "request 8c1f… failed" leads to
 * the log line, and behind Cloudflare to its log too.
 *
 * - Behind the Worker (origin verified), Cloudflare's `cf-ray` is used: it
 *   is unique per request and already in Cloudflare's own logs.
 * - Otherwise a fresh UUID.
 * - A value the client sends in {@link REQUEST_ID_HEADER} is never trusted:
 *   the proxy always overwrites it, exactly like the verified-origin header.
 */

export const REQUEST_ID_HEADER = "x-vokr-request-id";
export const RESPONSE_REQUEST_ID_HEADER = "x-request-id";

const CF_RAY = /^[0-9a-f]{16}(?:-[A-Z]{3})?$/;
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The id the proxy assigns: `cf-ray` on an origin-verified request, a UUID otherwise. */
export function assignRequestId(headers: Headers, originVerified: boolean): string {
  const ray = headers.get("cf-ray");
  if (originVerified && ray && CF_RAY.test(ray)) return ray;
  return crypto.randomUUID();
}

/**
 * The id the proxy assigned to this request. A route reached without the
 * proxy (a test, or a malformed value) gets a fresh one, never an
 * arbitrary client string.
 */
export function requestIdOf(request: Request): string {
  const id = request.headers.get(REQUEST_ID_HEADER);
  return id && SAFE_ID.test(id) ? id : crypto.randomUUID();
}
