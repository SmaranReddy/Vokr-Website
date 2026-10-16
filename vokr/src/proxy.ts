import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv, requireServerEnv } from "@/lib/env";
import {
  checkOrigin,
  type OriginCheck,
  VERIFIED_ORIGIN_HEADER,
} from "@/server/net/origin-auth";
import { checkCrossSite, siteOriginFrom } from "@/server/net/csrf";
import {
  assignRequestId,
  REQUEST_ID_HEADER,
  RESPONSE_REQUEST_ID_HEADER,
} from "@/server/net/request-id";

// Read once at module load (boot), never per request.
const originAuthSecret = requireServerEnv().ORIGIN_AUTH_SECRET;
// The site's own origin for the cross-site check — from configuration,
// never from `request.url` (behind Cloud Run that is the bind address).
const siteOrigin = siteOriginFrom(clientEnv.NEXT_PUBLIC_SITE_URL || "http://localhost:3000") ?? "http://localhost:3000";

/**
 * `NextResponse.next({ request })` is how a header set here reaches
 * downstream Server Components and Route Handlers without ever being
 * sent back to the browser in `response.headers`. Rebuilt from the live
 * `request.headers` at each call site (rather than cloned once) so it
 * still carries whatever the Supabase cookie refresh below has written
 * into `request` by the time it runs.
 *
 * `VERIFIED_ORIGIN_HEADER` is always written one way or the other — set
 * when trusted, deleted otherwise — never passed through, so a client
 * that sends its own copy on an exempt path (`/api/health`) cannot make
 * `src/server/net/client-ip.ts` trust a forged IP.
 */
function nextWithOriginVerdict(
  request: NextRequest,
  verdict: Exclude<OriginCheck, "refused">,
  requestId: string,
) {
  const headers = new Headers(request.headers);
  if (verdict === "trusted") {
    headers.set(VERIFIED_ORIGIN_HEADER, "1");
  } else {
    headers.delete(VERIFIED_ORIGIN_HEADER);
  }
  // Always overwritten, never passed through (Phase 15, task 5).
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(RESPONSE_REQUEST_ID_HEADER, requestId);
  return response;
}

/**
 * Requests that skip the Supabase session refresh: build output, the
 * favicon and image files. These used to be excluded by the `matcher`
 * itself, which skipped the origin check too — and because the exclusion
 * matched on a path *suffix*, `/shop/anything.png` and
 * `/api/catalog/products/anything.png` reached the dynamic page and the
 * route handler with no secret at all. The matcher now covers every
 * request; only the session refresh, which costs a Supabase Auth call,
 * is skipped here.
 */
const SKIP_SESSION_REFRESH =
  /^\/(?:_next\/static\/|_next\/image|favicon\.ico$)|\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy` (the old
 * name is deprecated and the framework logs a warning on build) — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
 * Same file location and `config`/matcher shape, only the file and
 * exported function are renamed.
 *
 * Keeps the Supabase session cookie fresh on every request. Per the
 * `@supabase/ssr` server-client contract: if a route or component only
 * ever reads cookies (Server Components can't write them), an expired
 * access token is never refreshed and the customer is silently logged out
 * the moment it lapses. This is the one place in the app guaranteed to run
 * on every request and able to write the refreshed cookie back to the
 * response.
 *
 * R13 (Cloud Run's shared egress IP vs. Supabase Auth's per-IP rate
 * limit): the `/api/auth/*` route handlers, not this file, are what
 * forward the real customer IP to Supabase and carry this app's own
 * authoritative rate limiting — see `src/server/auth/supabase.ts`
 * (`createRouteSupabaseClient`) and ADR-025 in
 * Vokr-Implementation-Plan.md §11.
 */
export async function proxy(request: NextRequest) {
  // D9 (ADR-031): once ORIGIN_AUTH_SECRET is configured (production), a
  // request that skips the Cloudflare Worker — e.g. straight to `run.app`
  // — never carries the matching header and is refused here. Unconfigured
  // (local/dev/preview, no Worker in front) always passes.
  const verdict = checkOrigin(request, originAuthSecret);
  const requestId = assignRequestId(request.headers, verdict === "trusted");
  if (verdict === "refused") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { [RESPONSE_REQUEST_ID_HEADER]: requestId },
    });
  }

  // Phase 16, task 3: a state-changing API request from another site is
  // refused before any route handler (or session refresh) runs.
  if (checkCrossSite(request, siteOrigin) === "refused") {
    return NextResponse.json(
      { error: { code: "CROSS_SITE_REQUEST", message: "Cross-site requests are not allowed.", requestId } },
      { status: 403, headers: { [RESPONSE_REQUEST_ID_HEADER]: requestId } },
    );
  }

  let response = nextWithOriginVerdict(request, verdict, requestId);

  if (SKIP_SESSION_REFRESH.test(request.nextUrl.pathname)) {
    return response;
  }

  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Supabase not configured yet (e.g. a clean checkout before Phase 3
    // secrets are supplied) — pass the request through unauthenticated
    // rather than failing every page.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = nextWithOriginVerdict(request, verdict, requestId);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Must be called for the refresh-and-rewrite above to ever run — see
  // the `@supabase/ssr` `CookieMethodsServer.setAll` doc comment.
  await supabase.auth.getUser();

  return response;
}

/**
 * Every request, deliberately — see `SKIP_SESSION_REFRESH`. A path this
 * matcher does not cover is a path the origin check does not cover.
 */
export const config = {
  matcher: ["/:path*"],
};
