import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { redirectTo } from "@/server/net/redirect";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { parseConfirmParams } from "@/server/auth/confirm";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";

/**
 * Email-confirmation landing point — Supabase's documented server-side
 * `token_hash` flow.
 *
 * The signup confirmation email links here with `?token_hash=…&type=signup`
 * and we exchange that for a session with `verifyOtp()`. This exists
 * *instead of* routing confirmations through `/api/auth/callback`, which
 * calls `exchangeCodeForSession()` and therefore needs the PKCE code
 * verifier cookie belonging to the browser that started the signup.
 * Confirmation links are opened elsewhere constantly — a phone, webmail, a
 * mail-provider link scanner — and every one of those cases failed with
 * `AuthPKCECodeVerifierMissingError`, leaving the address verified but the
 * customer not signed in (Vokr-Implementation-Plan.md, Phase 3
 * verification round 2). `verifyOtp()` needs nothing from the browser, so
 * it works from any device.
 *
 * `/api/auth/callback` is unchanged and still owns the OAuth `?code=`
 * exchange, which genuinely is PKCE and genuinely does start in the same
 * browser.
 *
 * On success this runs the same `completeSignIn()` the password sign-in
 * and OAuth callback run — guest-session upgrade, guest cookie cleared,
 * `app_users` row created — so a confirmed customer arrives with exactly
 * the identity every other authenticated path produces. Session cookies
 * are written by the Supabase client's cookie adapter and applied to the
 * redirect via `applyCookies()`.
 *
 * Every failure redirects to `/sign-in?error=confirm` with no detail: a
 * forged or expired link must not reveal which part was wrong. The reason
 * goes to the server log instead.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  let cookiesToSet: CookieWrite[] = [];

  const failure = (reason: string, cause?: unknown) => {
    logServerError(
      "auth/confirm",
      crypto.randomUUID(),
      new Error(reason, cause === undefined ? undefined : { cause }),
    );
    return applyCookies(
      redirectTo("/sign-in?error=confirm"),
      cookiesToSet,
    );
  };

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const parsed = parseConfirmParams(url.searchParams);
    if (!parsed.ok) {
      return failure(`rejected confirmation link: ${parsed.reason}`);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      type: parsed.type,
      token_hash: parsed.tokenHash,
    });

    if (error || !data.user || !data.session) {
      // A missing session with no error would mean a verified token that
      // produced no credentials — treat it as a failure rather than
      // redirecting a signed-out visitor to a page that assumes otherwise.
      return failure(
        "verifyOtp() did not return an authenticated session" +
          (error ? "" : " (no error reported)"),
        error,
      );
    }

    await completeSignIn({
      request,
      cookiesToSet,
      userId: data.user.id,
      userEmail: data.user.email ?? "",
    });

    return applyCookies(
      redirectTo(parsed.next),
      cookiesToSet,
    );
  } catch (error) {
    return failure("unexpected failure confirming email", error);
  }
}
