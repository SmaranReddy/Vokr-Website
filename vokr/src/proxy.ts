import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { clientEnv, requireServerEnv } from "@/lib/env";
import {
  isOriginAuthorized,
  VERIFIED_ORIGIN_HEADER,
} from "@/server/net/origin-auth";

// Read once at module load (boot), never per request.
const originAuthSecret = requireServerEnv().ORIGIN_AUTH_SECRET;

/**
 * `NextResponse.next({ request })` is how a header set here reaches
 * downstream Server Components and Route Handlers without ever being
 * sent back to the browser in `response.headers`. Rebuilt from the live
 * `request.headers` at each call site (rather than cloned once) so it
 * still carries whatever the Supabase cookie refresh below has written
 * into `request` by the time it runs.
 */
function nextWithVerifiedOrigin(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(VERIFIED_ORIGIN_HEADER, "1");
  return NextResponse.next({ request: { headers } });
}

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
  if (!isOriginAuthorized(request, originAuthSecret)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let response = nextWithVerifiedOrigin(request);

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
        response = nextWithVerifiedOrigin(request);
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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
