import { describe, expect, it } from "vitest";

import { signInErrorMessage } from "@/lib/auth-error-messages";

describe("signInErrorMessage", () => {
  it.each(["confirm", "oauth"])(
    "returns copy for the `%s` code the auth routes redirect with",
    (code) => {
      const message = signInErrorMessage(code);
      expect(message).toBeTypeOf("string");
      expect(message).not.toBe("");
    },
  );

  it("uses the first value when the parameter is repeated", () => {
    expect(signInErrorMessage(["confirm", "oauth"])).toBe(
      signInErrorMessage("confirm"),
    );
  });

  it.each([undefined, "", "unknown", "Confirm", "  confirm  "])(
    "returns null for an unrecognised code (%p)",
    (code) => {
      expect(signInErrorMessage(code)).toBeNull();
    },
  );

  it("returns null rather than echoing attacker-supplied text", () => {
    // The value comes straight from the URL. Rendering it would put
    // arbitrary copy on our own sign-in page — a phishing primitive.
    const injected = "<img src=x onerror=alert(1)>";
    expect(signInErrorMessage(injected)).toBeNull();
    expect(signInErrorMessage([injected])).toBeNull();
  });

  it("returns null for an empty repeated parameter", () => {
    expect(signInErrorMessage([])).toBeNull();
  });

  it("does not inherit keys from Object.prototype", () => {
    // A Record lookup on a plain object literal would otherwise resolve
    // `constructor` or `toString` to a function and render it.
    for (const key of ["constructor", "toString", "__proto__", "valueOf"]) {
      expect(signInErrorMessage(key)).toBeNull();
    }
  });
});
