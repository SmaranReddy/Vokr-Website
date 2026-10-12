import { describe, expect, it } from "vitest";

import { classifyResetResult } from "@/server/auth/reset-error";

describe("classifyResetResult", () => {
  it("treats a null error as the generic success", () => {
    expect(classifyResetResult(null)).toEqual({ kind: "generic-success" });
  });

  it("treats an undefined error as the generic success", () => {
    expect(classifyResetResult(undefined)).toEqual({ kind: "generic-success" });
  });

  it("reports a failed recovery-email send as operational, never as a success (R12's silent-failure signature)", () => {
    const outcome = classifyResetResult({
      code: "unexpected_failure",
      status: 500,
      message: "Error sending recovery email",
    });
    expect(outcome.kind).toBe("operational");
    expect(outcome).toHaveProperty(
      "reason",
      expect.stringContaining("Error sending recovery email"),
    );
  });

  it.each(["email_provider_disabled", "validation_failed", "unknown_code"])(
    "reports %s as operational",
    (code) => {
      expect(classifyResetResult({ code, status: 500 }).kind).toBe(
        "operational",
      );
    },
  );

  it.each(["over_email_send_rate_limit", "over_request_rate_limit"])(
    "answers %s generically but still logs it — GoTrue's cooldown is keyed on the user row, so surfacing it would leak whether the address is registered",
    (code) => {
      const outcome = classifyResetResult({
        code,
        status: 429,
        message:
          "For security purposes, you can only request this after 45 seconds.",
      });
      expect(outcome.kind).toBe("silent-failure");
      expect(outcome).toHaveProperty(
        "reason",
        expect.stringContaining("45 seconds"),
      );
    },
  );

  it("treats a bare 429 with no code as the same non-disclosing case", () => {
    expect(classifyResetResult({ status: 429 }).kind).toBe("silent-failure");
  });

  it("states an invalid address plainly — that concerns the address's form, not its registration", () => {
    expect(classifyResetResult({ code: "email_address_invalid" })).toEqual({
      kind: "validation",
      message: "That email address is not valid.",
    });
  });

  it.each([["a string"], [42], [true]])(
    "treats a non-object error (%s) as operational rather than trusting its shape",
    (error) => {
      expect(classifyResetResult(error).kind).toBe("operational");
    },
  );

  it("ignores fields of the wrong runtime type instead of interpolating them", () => {
    const outcome = classifyResetResult({ code: 500, status: "429" });
    expect(outcome.kind).toBe("operational");
    expect(outcome).toHaveProperty(
      "reason",
      expect.stringContaining("code=unknown"),
    );
  });
});
