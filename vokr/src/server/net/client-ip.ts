/**
 * Best-effort real client IP, read from the headers Cloudflare (the
 * PDF's edge layer, plan §3.1) and Cloud Run attach to every request.
 * `cf-connecting-ip` is authoritative when the request passed through
 * Cloudflare; `x-forwarded-for`'s first hop is the fallback for local
 * development and any request that reaches Cloud Run directly. Returns
 * `"unknown"` rather than throwing — an unresolvable IP degrades rate
 * limiting to a shared bucket, it must never break the request.
 */
export function getClientIp(request: Request): string {
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
