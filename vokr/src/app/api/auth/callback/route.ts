import { NextResponse, type NextRequest } from "next/server";

import { completeSignIn } from "@/server/auth/complete-sign-in";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";

/**
 * Google OAuth (and any future email-link / magic-link) landing point.
 * Supabase redirects the browser here with a `?code=` once the provider
 * confirms the user; we exchange it for a session, then run the same
 * guest-upgrade + profile-creation path password sign-in uses. A redirect
 * response, unlike the JSON routes, has no error body to speak of — any
 * failure here sends the browser back to sign-in with a generic error
 * flag rather than exposing detail.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  let cookiesToSet: CookieWrite[] = [];

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const code = url.searchParams.get("code");
    if (!code) {
      return applyCookies(
        NextResponse.redirect(new URL("/sign-in?error=oauth", url.origin)),
        cookiesToSet,
      );
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      return applyCookies(
        NextResponse.redirect(new URL("/sign-in?error=oauth", url.origin)),
        cookiesToSet,
      );
    }

    await completeSignIn({
      request,
      cookiesToSet,
      userId: data.user.id,
      userEmail: data.user.email ?? "",
    });

    return applyCookies(
      NextResponse.redirect(new URL("/", url.origin)),
      cookiesToSet,
    );
  } catch {
    return applyCookies(
      NextResponse.redirect(new URL("/sign-in?error=oauth", url.origin)),
      cookiesToSet,
    );
  }
}
