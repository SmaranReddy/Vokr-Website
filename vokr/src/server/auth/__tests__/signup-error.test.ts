import { describe, expect, it } from "vitest";

import { classifySignupResult } from "@/server/auth/signup-error";

describe("classifySignupResult", () => {
  it("treats a normal signup (no error, a user) as the generic success", () => {
    expect(classifySignupResult(null, true)).toEqual({
      kind: "generic-success",
    });
  });

  it.each(["user_already_exists", "email_exists"])(
    "hides %s behind the generic success message — the one fact anti-enumeration must conceal",
    (code) => {
      expect(classifySignupResult({ code, status: 422 }, false)).toEqual({
        kind: "generic-success",
      });
    },
  );

  it("reports a failed confirmation-email send as operational, never as a success (R12's silent-failure signature)", () => {
    const outcome = classifySignupResult(
      {
        code: "unexpected_failure",
        status: 500,
        message: "Error sending confirmation email",
      },
      false,
    );
    expect(outcome.kind).toBe("operational");
    expect(outcome).toHaveProperty(
      "reason",
      expect.stringContaining("Error sending confirmation email"),
    );
  });

  it.each([
    "signup_disabled",
    "email_provider_disabled",
    "email_address_not_authorized",
  ])("reports %s as operational rather than a fake success", (code) => {
    expect(classifySignupResult({ code, status: 422 }, false).kind).toBe(
      "operational",
    );
  });

  it.each(["over_email_send_rate_limit", "over_request_rate_limit"])(
    "maps %s to a rate-limited outcome",
    (code) => {
      const outcome = classifySignupResult({ code, status: 429 }, false);
      expect(outcome.kind).toBe("rate-limited");
    },
  );

  it("maps an unrecognised 429 to rate-limited even without a known code", () => {
    expect(classifySignupResult({ status: 429 }, false).kind).toBe(
      "rate-limited",
    );
  });

  it("surfaces weak_password as a validation error the caller can act on", () => {
    const outcome = classifySignupResult(
      { code: "weak_password", status: 422 },
      false,
    );
    expect(outcome.kind).toBe("validation");
  });

  it("surfaces email_address_invalid as a validation error", () => {
    expect(
      classifySignupResult(
        { code: "email_address_invalid", status: 400 },
        false,
      ).kind,
    ).toBe("validation");
  });

  it("treats a null error with no user as operational, not success", () => {
    const outcome = classifySignupResult(null, false);
    expect(outcome.kind).toBe("operational");
  });

  it("never puts the raw Supabase message into a caller-visible field", () => {
    const outcome = classifySignupResult(
      { code: "weak_password", status: 422, message: "internal detail" },
      false,
    );
    expect(JSON.stringify(outcome)).not.toContain("internal detail");
  });
});
