/**
 * Classifies the error `supabase.auth.signUp()` returns.
 *
 * The signup route previously destructured only `data` and threw the
 * `error` away entirely. That silently converted *every* Supabase-side
 * failure into an HTTP 200 carrying "a confirmation link is on its way" —
 * including the one failure this whole phase exists to prevent: SMTP not
 * configured, so no email is ever sent (plan §5 Phase 3 / R12, the
 * "single most dangerous item in the programme", whose signature is
 * precisely "`signUp()` succeeds, the email never arrives, no client
 * error"). Discarding the error made the app reproduce that failure mode
 * on its own, independently of the SMTP configuration.
 *
 * Anti-enumeration is still the rule, but it only requires hiding *one*
 * fact: whether the address is already registered. It never required
 * hiding SMTP failures, a disabled provider or a rate limit — none of
 * which say anything about the submitted address. So exactly the
 * already-registered codes collapse into the generic success message
 * (matching Supabase's own behaviour when confirmations are on, where a
 * duplicate returns a user with an empty `identities` array and no
 * error), and everything else is reported honestly.
 */
import {
  describeSupabaseError,
  isRateLimit,
  readSupabaseError,
} from "./supabase-error";

export type SignupOutcome =
  /** Respond with the generic message — either a real signup or an address-exists result that must stay indistinguishable from one. */
  | { kind: "generic-success" }
  /** Safe to state plainly: concerns the password or the address's validity, not whether it is registered. */
  | { kind: "validation"; message: string }
  /** Supabase's own send/request limiter tripped. */
  | { kind: "rate-limited"; message: string }
  /** A real failure (SMTP, provider disabled, config, outage). Must surface as a failure and be logged — never as a fake success. */
  | { kind: "operational"; reason: string };

/** Codes that reveal the address is already registered — the one fact the response must not expose. */
const ALREADY_REGISTERED_CODES = new Set([
  "user_already_exists",
  "email_exists",
]);

/**
 * @param error   The `error` field of the `signUp()` result (`null` on success).
 * @param hasUser Whether the result carried a `data.user`. A null error *and*
 *                no user is not a success — it is an unrecognised response
 *                shape, and treating it as one would resurrect the same
 *                silent-failure bug from the other direction.
 */
export function classifySignupResult(
  error: unknown,
  hasUser: boolean,
): SignupOutcome {
  if (error === null || error === undefined) {
    return hasUser
      ? { kind: "generic-success" }
      : {
          kind: "operational",
          reason: "signUp() returned neither an error nor a user",
        };
  }

  const parsed = readSupabaseError(error);
  const { code } = parsed;

  if (code !== undefined && ALREADY_REGISTERED_CODES.has(code)) {
    return { kind: "generic-success" };
  }

  if (isRateLimit(parsed)) {
    return {
      kind: "rate-limited",
      message: "Too many signup attempts. Please try again later.",
    };
  }

  if (code === "weak_password") {
    return {
      kind: "validation",
      message: "That password is too weak. Choose a longer one.",
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
    reason: describeSupabaseError("signUp()", parsed),
  };
}
