import {
  describeSupabaseError,
  isRateLimit,
  readSupabaseError,
} from "./supabase-error";

/**
 * Classifies the error `supabase.auth.resetPasswordForEmail()` returns.
 *
 * `POST /api/auth/reset` previously ignored that error completely —
 * `await supabase.auth.resetPasswordForEmail(...)` with no destructuring
 * at all. Every Supabase-side failure therefore became an HTTP 200
 * carrying "a password reset link is on its way": SMTP misconfigured,
 * the email provider disabled, GoTrue's 60-second recovery cooldown, a
 * project outage — all indistinguishable from a real send. That is R12's
 * silent-failure signature (plan §5 Phase 3), the same defect
 * `signup-error.ts` was written to close on the signup route, still open
 * on this one. Reported 9 Sep 2026 as "no reset email was received".
 *
 * Anti-enumeration still governs the response, and for recovery it is
 * *stricter* than for signup. GoTrue's "you can only request this after
 * N seconds" limit is keyed on the user row's `recovery_sent_at`, so it
 * can only ever trip for an address that is actually registered:
 * surfacing it as its own status would turn the reset form into an
 * account-existence oracle. It is therefore logged but answered with the
 * generic message. The route's own per-email limiter
 * (`auth:reset:email:*`) is what legitimately reports "too many
 * requests" — it counts every submitted address alike, registered or
 * not, so it reveals nothing.
 *
 * Address-independent failures — SMTP, a disabled provider, an outage —
 * say nothing about the submitted address and are reported honestly as
 * failures, exactly as on signup.
 */
export type ResetOutcome =
  /** Respond with the generic message; nothing to log. */
  | { kind: "generic-success" }
  /** Safe to state plainly: concerns the address's validity, not whether it is registered. */
  | { kind: "validation"; message: string }
  /**
   * Respond with the generic message, but log `reason` — the send did not
   * happen, and only the server log may say so. Used for GoTrue's
   * user-specific recovery cooldown.
   */
  | { kind: "silent-failure"; reason: string }
  /** A real failure (SMTP, provider disabled, config, outage). Must surface as a failure and be logged — never as a fake success. */
  | { kind: "operational"; reason: string };

/**
 * @param error The `error` field of the `resetPasswordForEmail()` result
 *              (`null` on success).
 *
 * Note there is no `hasUser` counterpart to `classifySignupResult()`'s
 * second argument: `resetPasswordForEmail()` resolves with an empty
 * `data` object by design, for registered and unregistered addresses
 * alike, so a null error is the only success signal available.
 */
export function classifyResetResult(error: unknown): ResetOutcome {
  if (error === null || error === undefined) {
    return { kind: "generic-success" };
  }

  const parsed = readSupabaseError(error);
  const { code } = parsed;

  if (isRateLimit(parsed)) {
    // Generic response, logged reason — see the module comment on why
    // this one may not be reported to the caller.
    return {
      kind: "silent-failure",
      reason: describeSupabaseError("resetPasswordForEmail()", parsed),
    };
  }

  if (code === "email_address_invalid") {
    return {
      kind: "validation",
      message: "That email address is not valid.",
    };
  }

  return {
    kind: "operational",
    reason: describeSupabaseError("resetPasswordForEmail()", parsed),
  };
}
