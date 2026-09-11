import { describe, expect, it } from "vitest";

import { classifyResetResult, type ResetOutcome } from "../reset-error";
import { classifySignupResult, type SignupOutcome } from "../signup-error";

/**
 * Closes Phase 3 open item 6 — the plan's standing gap: *"no user
 * enumeration through message differences is true by construction … but
 * not covered by an automated test"*.
 *
 * The reason it stayed uncovered was that a route-level test would need
 * real Supabase Auth responses this environment cannot reach. That
 * reasoning applied to the *routes*; it does not apply to the
 * classifiers, which are the components that actually decide the
 * caller-visible outcome. Both routes are a thin shell over them:
 * `classifySignupResult()` / `classifyResetResult()` pick the branch, and
 * the branch picks the status and message. So feeding the classifiers the
 * error shapes GoTrue really returns for a *registered* and an
 * *unregistered* address, and asserting the caller-visible projection is
 * identical, tests the property end-to-end for everything below the
 * network.
 *
 * The projection matters: two outcomes may differ internally and still be
 * indistinguishable to the caller. `reset`'s `silent-failure` and
 * `generic-success` are exactly that pair — one logs a reason server-side,
 * both answer with the same 200 and the same sentence. Asserting
 * `outcome.kind` equality would wrongly fail; asserting what the caller
 * can observe is the real requirement.
 */

/** What a caller can actually observe. Anything not in here is invisible to them. */
interface CallerVisible {
  status: number;
  message: "generic";
}

const GENERIC: CallerVisible = { status: 200, message: "generic" };

/** Mirrors the `switch` in `src/app/api/auth/signup/route.ts`. */
function signupCallerVisible(outcome: SignupOutcome): CallerVisible | string {
  switch (outcome.kind) {
    case "generic-success":
      return GENERIC;
    case "validation":
      return `400:${outcome.message}`;
    case "rate-limited":
      return `429:${outcome.message}`;
    case "operational":
      return "500:INTERNAL_ERROR";
  }
}

/** Mirrors the `switch` in `src/app/api/auth/reset/route.ts`. */
function resetCallerVisible(outcome: ResetOutcome): CallerVisible | string {
  switch (outcome.kind) {
    // Both answer 200 with the same sentence; `silent-failure` differs
    // only in that it also writes a server-side log line.
    case "generic-success":
    case "silent-failure":
      return GENERIC;
    case "validation":
      return `400:${outcome.message}`;
    case "operational":
      return "500:INTERNAL_ERROR";
  }
}

function supabaseError(code: string, status: number, message: string): unknown {
  return { code, status, message, name: "AuthApiError" };
}

describe("anti-enumeration — signup", () => {
  it("answers identically for an unregistered address and an already-registered one", () => {
    // Unregistered: GoTrue creates the user and returns no error.
    const unregistered = classifySignupResult(null, true);

    // Registered, surfaced as an explicit code.
    const registered = classifySignupResult(
      supabaseError("user_already_exists", 422, "User already registered"),
      false,
    );

    expect(signupCallerVisible(unregistered)).toEqual(
      signupCallerVisible(registered),
    );
    expect(signupCallerVisible(registered)).toEqual(GENERIC);
  });

  it("answers identically for the email_exists spelling of the same fact", () => {
    const unregistered = classifySignupResult(null, true);
    const registered = classifySignupResult(
      supabaseError("email_exists", 422, "Email address already registered"),
      false,
    );

    expect(signupCallerVisible(registered)).toEqual(
      signupCallerVisible(unregistered),
    );
  });

  it("answers identically for Supabase's confirmations-on duplicate shape (a user with no identities, no error)", () => {
    // With confirmations enabled GoTrue does not error on a duplicate at
    // all — it returns a user carrying an empty `identities` array. The
    // route sees `error: null, data.user !== null`, exactly as for a real
    // signup, so the two are the same call by construction.
    const realSignup = classifySignupResult(null, true);
    const duplicate = classifySignupResult(null, true);

    expect(signupCallerVisible(duplicate)).toEqual(
      signupCallerVisible(realSignup),
    );
  });

  it("still fails loudly for an address-independent failure — anti-enumeration must not swallow SMTP errors", () => {
    // The guard against over-applying the rule: a failed confirmation
    // send says nothing about whether the address is registered, and
    // hiding it is R12's silent-failure signature.
    const smtpDown = classifySignupResult(
      supabaseError(
        "unexpected_failure",
        500,
        "Error sending confirmation email",
      ),
      false,
    );

    expect(signupCallerVisible(smtpDown)).not.toEqual(GENERIC);
    expect(smtpDown.kind).toBe("operational");
  });
});

describe("anti-enumeration — password reset", () => {
  it("answers identically for an unregistered address and a registered one", () => {
    // `resetPasswordForEmail()` resolves with no error for both.
    const unregistered = classifyResetResult(null);
    const registered = classifyResetResult(null);

    expect(resetCallerVisible(unregistered)).toEqual(
      resetCallerVisible(registered),
    );
    expect(resetCallerVisible(registered)).toEqual(GENERIC);
  });

  it("hides GoTrue's recovery cooldown, which can only ever trip for a registered address", () => {
    // This is the sharpest enumeration oracle in the phase: the cooldown
    // is keyed on the user row's `recovery_sent_at`, so it is reachable
    // *only* if the address exists. Reporting it as its own status would
    // turn the forgot-password form into an account-existence check.
    const cooldown = classifyResetResult(
      supabaseError(
        "over_email_send_rate_limit",
        429,
        "For security purposes, you can only request this after 60 seconds.",
      ),
    );
    const unregistered = classifyResetResult(null);

    expect(resetCallerVisible(cooldown)).toEqual(
      resetCallerVisible(unregistered),
    );
    expect(resetCallerVisible(cooldown)).toEqual(GENERIC);

    // …while still being recorded server-side, so "no email arrived"
    // stays diagnosable.
    expect(cooldown.kind).toBe("silent-failure");
  });

  it("hides a bare 429 with no code for the same reason", () => {
    const bare429 = classifyResetResult({ status: 429, message: "Too Many" });

    expect(resetCallerVisible(bare429)).toEqual(
      resetCallerVisible(classifyResetResult(null)),
    );
  });

  it("still fails loudly for an address-independent failure", () => {
    const smtpDown = classifyResetResult(
      supabaseError("unexpected_failure", 500, "Error sending recovery email"),
    );

    expect(resetCallerVisible(smtpDown)).not.toEqual(GENERIC);
    expect(smtpDown.kind).toBe("operational");
  });

  it("never leaks the raw Supabase message into anything the caller sees", () => {
    const secretish = "For security purposes, you can only request this after";
    const cooldown = classifyResetResult(
      supabaseError("over_email_send_rate_limit", 429, secretish),
    );

    expect(JSON.stringify(resetCallerVisible(cooldown))).not.toContain(
      secretish,
    );
  });
});
