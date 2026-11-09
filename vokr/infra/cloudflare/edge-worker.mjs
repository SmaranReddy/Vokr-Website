// Cloudflare Worker — the public edge for vokr.shop.
// D9 option 1 (Vokr-Implementation-Plan.md §0.3, ADR-031).
//
// Cloudflare Free cannot rewrite the Host header, and Cloud Run domain
// mapping does not exist in asia-south1, so this Worker is the reverse
// proxy: it forwards each request to the Cloud Run service's own hostname
// and stamps it with a shared origin secret. Once the application enforces
// that secret (pending — docs/infrastructure/domain-and-dns.md), a request
// that goes around Cloudflare is refused.
//
// Configuration is never committed: ORIGIN_HOST is a [vars] entry in
// wrangler.toml, ORIGIN_AUTH_SECRET is set with `wrangler secret put`.
// Either missing -> 503, never an unauthenticated pass-through.

export const ORIGIN_AUTH_HEADER = "x-vokr-origin-auth";

// Build output and content-hashed images: the only responses shared between
// visitors. A subrequest to the run.app host does not pass through this
// zone's cache, so without this every file reaches Cloud Run. HTML is never
// cached here: it carries a per-request CSP nonce.
const SHARED_ASSET_PATH = /^\/(?:_next\/static|img)\//;

function isSharedAsset(response) {
  return (
    response.status === 200 &&
    /\bimmutable\b/i.test(response.headers.get("cache-control") ?? "") &&
    !response.headers.has("set-cookie")
  );
}

const worker = {
  async fetch(request, env, ctx) {
    const originHost = env.ORIGIN_HOST;
    const originSecret = env.ORIGIN_AUTH_SECRET;
    if (!originHost || !originSecret) {
      return new Response("Service temporarily unavailable.", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }

    const publicUrl = new URL(request.url);

    // Keyed on the URL alone, so a visitor's cookies never reach the cache.
    const cacheKey =
      ctx && request.method === "GET" && SHARED_ASSET_PATH.test(publicUrl.pathname)
        ? new Request(publicUrl.toString())
        : null;
    if (cacheKey) {
      const cached = await caches.default.match(cacheKey);
      if (cached) return cached;
    }

    const upstreamUrl = new URL(
      publicUrl.pathname + publicUrl.search,
      `https://${originHost}`,
    );

    // Overwrite, never append: a client-supplied copy of any of these is
    // discarded. Host comes from the upstream URL.
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set(ORIGIN_AUTH_HEADER, originSecret);
    headers.set("x-forwarded-host", publicUrl.host);
    headers.set("x-forwarded-proto", "https");

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    });

    // An absolute redirect naming the origin must never send a visitor to
    // the run.app hostname. Relative and third-party redirects pass as-is.
    const location = upstream.headers.get("location");
    if (location && /^https?:\/\//i.test(location)) {
      const target = new URL(location);
      if (target.host === originHost) {
        target.protocol = publicUrl.protocol;
        target.host = publicUrl.host;
        const response = new Response(upstream.body, upstream);
        response.headers.set("location", target.toString());
        return response;
      }
    }
    if (cacheKey && isSharedAsset(upstream)) {
      ctx.waitUntil(caches.default.put(cacheKey, upstream.clone()));
    }
    return upstream;
  },
};

export default worker;
