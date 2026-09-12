import { VERIFIED_ORIGIN_HEADER } from "./origin-auth";

/**
 * Best-effort real client IP, read from the headers Cloudflare (the
 * PDF's edge layer, plan §3.1) and Cloud Run attach to every request.
 * `cf-connecting-ip` is authoritative when the request passed through
 * Cloudflare; `x-forwarded-for`'s first hop is the fallback for local
 * development and any request that reaches Cloud Run directly. Returns
 * `"unknown"` rather than throwing — an unresolvable IP degrades rate
 * limiting to a shared bucket, it must never break the request.
 *
 * D9 (ADR-031), R13: `run.app` stays publicly reachable even after the
 * domain cuts over to the Cloudflare Worker, so any caller can set
 * `cf-connecting-ip`/`x-forwarded-for` to whatever they like on a request
 * that skips Cloudflare entirely. `src/proxy.ts` stamps
 * `VERIFIED_ORIGIN_HEADER` only once it has checked the Worker's shared
 * secret; without it, every IP header here is untrusted and this returns
 * `"unknown"` rather than trust a forgeable value.
 */
export function getClientIp(request: Request): string {
  if (request.headers.get(VERIFIED_ORIGIN_HEADER) !== "1") {
    return "unknown";
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "unknown";
}
