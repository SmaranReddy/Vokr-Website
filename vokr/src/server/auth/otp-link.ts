/**
 * Shared validation for the email links Supabase's server-side OTP flow
 * sends — the signup confirmation (`/api/auth/confirm`) and the password
 * recovery link (`/api/auth/reset/confirm`).
 *
 * Both links carry an opaque `token_hash` that we hand straight to
 * `verifyOtp()`. Constraining its shape here keeps anything exotic out of
 * the Supabase request and out of the log line that records a rejection.
 */

/**
 * `token_hash` values are base64url-ish and, for PKCE-initiated flows,
 * carry a `pkce_` prefix — hence the underscore. The length ceiling is a
 * sanity bound, not a protocol constant.
 */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isValidTokenHash(value: string): boolean {
  return TOKEN_HASH_PATTERN.test(value);
}
