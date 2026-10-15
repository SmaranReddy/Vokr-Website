import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { redirectTo } from "@/server/net/redirect";
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
      // Every redirect below is a dead end for diagnosis unless the reason
      // is written down: the browser only ever sees `?error=oauth`. The
      // Phase 3 email-confirmation defect (callback never established a
      // session) was invisible for exactly this reason.
      logServerError(
        "auth/callback",
        crypto.randomUUID(),
        new Error(
          "no `code` query parameter on callback — " +
            `params=[${[...url.searchParams.keys()].join(",") || "none"}] ` +
            "(an implicit-flow link returns tokens in the URL fragment, " +
            "which never reaches the server)",
        ),
      );
      return applyCookies(
        redirectTo("/sign-in?error=oauth"),
        cookiesToSet,
      );
    }

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      logServerError(
        "auth/callback",
        crypto.randomUUID(),
        new Error(
          "exchangeCodeForSession() did not return a user" +
            (error ? "" : " (no error reported)"),
          { cause: error },
        ),
      );
      return applyCookies(
        redirectTo("/sign-in?error=oauth"),
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
      redirectTo("/"),
      cookiesToSet,
    );
  } catch (error) {
    logServerError("auth/callback", crypto.randomUUID(), error);
    return applyCookies(
      redirectTo("/sign-in?error=oauth"),
      cookiesToSet,
    );
  }
}
