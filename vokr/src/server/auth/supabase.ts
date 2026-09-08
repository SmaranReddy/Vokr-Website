import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { clientEnv } from "@/lib/env";
import { getClientIp } from "@/server/net/client-ip";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CookieWrite {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface RouteSupabaseClient {
  supabase: SupabaseClient;
  /**
   * Cookies the Supabase client wants written to the response (session
   * cookies on sign-in/sign-out, refreshed tokens). Collected here rather
   * than applied directly because a Route Handler's outgoing
   * `NextResponse` does not exist yet when the client is constructed —
   * apply with {@link applyCookies} on the response you actually return.
   */
  cookiesToSet: CookieWrite[];
}

function requireSupabasePublicConfig(): { url: string; anonKey: string } {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "See .env.example.",
    );
  }
  return { url, anonKey };
}

/**
 * A fresh Supabase server client for one Route Handler invocation, bound
 * to the incoming request's cookies. Per the `@supabase/ssr` contract,
 * always create a new client per request — never share one across
 * requests or cache it at module scope.
 *
 * ADR-025 (R13): every server-to-Supabase-Auth call this client makes
 * carries the real customer IP (Cloudflare's `cf-connecting-ip`, or the
 * `x-forwarded-for` fallback — see `getClientIp`) as `X-Forwarded-For`,
 * best-effort, since Cloud Run's own egress IP would otherwise be the only
 * IP Supabase's hosted rate limiter ever sees, capping *every* customer's
 * sign-in attempts to one shared bucket. Whether hosted GoTrue trusts a
 * forwarded header from an arbitrary caller is undocumented and outside
 * this project's control, so this app's own IP-and-email-keyed
 * `rate_limit_counters` limiting (`src/server/rate-limit/`) is the
 * limiting Vokr actually relies on — this header is additional depth, not
 * the primary defence. See Vokr-Implementation-Plan.md §11 ADR-025.
 */
export function createRouteSupabaseClient(
  request: NextRequest,
): RouteSupabaseClient {
  const { url, anonKey } = requireSupabasePublicConfig();
  const cookiesToSet: CookieWrite[] = [];
  const clientIp = getClientIp(request);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        cookiesToSet.push(...toSet);
      },
    },
    global: {
      headers: clientIp === "unknown" ? {} : { "X-Forwarded-For": clientIp },
    },
  });

  return { supabase, cookiesToSet };
}

/** Applies collected Supabase cookie writes to an outgoing response. Returns the same response for chaining. */
export function applyCookies<T extends NextResponse>(
  response: T,
  cookiesToSet: CookieWrite[],
): T {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
  return response;
}
