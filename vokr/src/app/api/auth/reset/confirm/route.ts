import { NextResponse, type NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import {
  RECOVERY_NEXT_PATH,
  parseRecoveryParams,
} from "@/server/auth/recovery";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";

/** Where a rejected link lands. `error=link` makes the form show the failure even to a visitor who happens to hold a session. */
const RECOVERY_FAILURE_PATH = `${RECOVERY_NEXT_PATH}?error=link`;

/**
 * Password-recovery landing point — Supabase's documented server-side
 * `token_hash` flow, and the mirror of `/api/auth/confirm`.
 *
 * The recovery email links here with `?token_hash=…&type=recovery`. We
 * exchange it with `verifyOtp()`, which establishes the short-lived
 * recovery session as cookies on the redirect, and send the customer to
 * `/reset-password` — a page whose only function is to demand a new
 * password.
 *
 * This exists because the previous flow could not work anywhere but the
 * originating browser. `reset-password-form.tsx` called
 * `exchangeCodeForSession(code)` in the browser, which needs the PKCE
 * code-verifier cookie written by the response to `POST /api/auth/reset`.
 * Open the link in a private window, another browser, a phone or webmail
 * and that cookie is absent, so the exchange failed and the page showed
 * "This reset link is invalid or has expired" — the failure reported on
 * 9 Sep 2026. `verifyOtp()` needs nothing from the browser.
 *
 * Session cookies are written by the Supabase client's cookie adapter and
 * applied to the redirect via `applyCookies()`; because `@supabase/ssr`
 * does not mark them `HttpOnly`, the browser client on `/reset-password`
 * picks the session up from `document.cookie` and can call
 * `auth.updateUser({ password })` — the existing architecture, reached by
 * a route that works from any device rather than only one.
 *
 * `completeSignIn()` is deliberately **not** run here, unlike the signup
 * confirmation. This is not a "guest becomes a customer" event: merging a
 * guest cart and rotating the guest cookie on the strength of an emailed
 * recovery link would let anything that touches that link — a stale inbox,
 * a mail-provider scanner — destroy a live guest session. The upgrade runs
 * when the customer actually signs in with the new password.
 *
 * Every failure redirects to the same place with no detail; the reason
 * goes to the server log.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  let cookiesToSet: CookieWrite[] = [];

  const failure = (reason: string, cause?: unknown) => {
    logServerError(
      "auth/reset/confirm",
      crypto.randomUUID(),
      new Error(reason, cause === undefined ? undefined : { cause }),
    );
    return applyCookies(
      NextResponse.redirect(new URL(RECOVERY_FAILURE_PATH, url.origin)),
      cookiesToSet,
    );
  };

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const parsed = parseRecoveryParams(url.searchParams);
    if (!parsed.ok) {
      return failure(`rejected recovery link: ${parsed.reason}`);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      type: parsed.type,
      token_hash: parsed.tokenHash,
    });

    if (error || !data.user || !data.session) {
      // No session with no error would mean a verified token that produced
      // no credentials — `updateUser()` would then fail on the next page.
      return failure(
        "verifyOtp() did not return a recovery session" +
          (error ? "" : " (no error reported)"),
        error,
      );
    }

    return applyCookies(
      NextResponse.redirect(new URL(RECOVERY_NEXT_PATH, url.origin)),
      cookiesToSet,
    );
  } catch (error) {
    return failure("unexpected failure redeeming a recovery link", error);
  }
}
