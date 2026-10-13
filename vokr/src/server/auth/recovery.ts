import { isValidTokenHash } from "./otp-link";

/**
 * Validation for the password-recovery landing endpoint
 * (`/api/auth/reset/confirm`).
 *
 * The recovery email links here with `token_hash` + `type=recovery`, which
 * the *server* exchanges via `verifyOtp()`. This replaces the previous
 * browser-side `exchangeCodeForSession(code)` in
 * `reset-password-form.tsx`, which needed the PKCE code-verifier cookie
 * written by the response to `POST /api/auth/reset` — i.e. it only ever
 * worked in the one browser that submitted the forgot-password form. Every
 * other case (a different browser, a private window, a phone, webmail)
 * failed deterministically and showed "This reset link is invalid or has
 * expired", which is exactly the failure reported on 9 Sep 2026. See
 * Vokr-Implementation-Plan.md, Phase 3 defect log.
 *
 * Kept out of the route file so it is unit-testable: the Vitest `node`
 * project covers `src/server/**` and `src/lib/**`, not `src/app/**`.
 */

/**
 * The only OTP type this endpoint will exchange.
 *
 * Narrower than a shared "confirm anything" endpoint on purpose, and the
 * mirror image of `/api/auth/confirm`, which refuses `recovery`. Keeping
 * the two apart is what guarantees the destination is fixed: a `recovery`
 * token always lands on `/reset-password`, which demands a new password
 * before anything else, and a `signup` token can never be redeemed here to
 * reach that page.
 */
export const RECOVERY_OTP_TYPE = "recovery" as const;

/**
 * Where a verified recovery link always lands.
 *
 * Deliberately fixed — there is no `next` parameter on this endpoint. A
 * recovery token mints a real session, so an attacker-chosen destination
 * would turn any reset email that reaches a stale inbox or a link scanner
 * into a sign-in at a page of their choosing. The one permitted
 * destination immediately requires the new password.
 */
export const RECOVERY_NEXT_PATH = "/reset-password";

export type RecoveryParams =
  | { ok: true; tokenHash: string; type: typeof RECOVERY_OTP_TYPE }
  | { ok: false; reason: string };

/**
 * Validates the query string of an incoming recovery link.
 *
 * `reason` is for the server log only — every failure redirects to the
 * same place with no detail, so a forged link learns nothing about which
 * part was wrong.
 */
export function parseRecoveryParams(params: URLSearchParams): RecoveryParams {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (!tokenHash) {
    return { ok: false, reason: "missing token_hash" };
  }
  if (!isValidTokenHash(tokenHash)) {
    return { ok: false, reason: "malformed token_hash" };
  }
  if (!type) {
    return { ok: false, reason: "missing type" };
  }
  if (type !== RECOVERY_OTP_TYPE) {
    return {
      ok: false,
      reason:
        `type "${type}" is not redeemable here ` +
        `(allowed: ${RECOVERY_OTP_TYPE})`,
    };
  }

  return { ok: true, tokenHash, type: RECOVERY_OTP_TYPE };
}
