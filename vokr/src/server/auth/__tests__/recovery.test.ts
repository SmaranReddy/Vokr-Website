import { describe, expect, it } from "vitest";

import {
  RECOVERY_NEXT_PATH,
  RECOVERY_OTP_TYPE,
  parseRecoveryParams,
} from "@/server/auth/recovery";

const VALID_HASH = "pkce_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parseRecoveryParams", () => {
  it("accepts a well-formed recovery link", () => {
    expect(
      parseRecoveryParams(params({ token_hash: VALID_HASH, type: "recovery" })),
    ).toEqual({ ok: true, tokenHash: VALID_HASH, type: "recovery" });
  });

  it("accepts the `pkce_` prefix a PKCE-initiated reset produces", () => {
    // resetPasswordForEmail() runs through the server client, whose flow
    // type is PKCE, so the emailed token_hash carries this prefix. A
    // charset check that rejected the underscore would break every real
    // link while passing every synthetic test.
    const result = parseRecoveryParams(
      params({ token_hash: "pkce_abc-123_XYZ", type: "recovery" }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["missing token_hash", { type: "recovery" }],
    ["missing type", { token_hash: VALID_HASH }],
    ["empty token_hash", { token_hash: "", type: "recovery" }],
  ])("rejects a link with %s", (_label, entries) => {
    expect(parseRecoveryParams(params(entries)).ok).toBe(false);
  });

  it.each([
    "not a hash!",
    "has space",
    "semi;colon",
    "slash/inside",
    "percent%20encoded",
  ])("rejects a malformed token_hash (%s)", (hash) => {
    expect(
      parseRecoveryParams(params({ token_hash: hash, type: "recovery" })).ok,
    ).toBe(false);
  });

  it("rejects a token_hash longer than the permitted length", () => {
    expect(
      parseRecoveryParams(
        params({ token_hash: "a".repeat(257), type: "recovery" }),
      ).ok,
    ).toBe(false);
  });

  // The mirror of the `/api/auth/confirm` restriction: that endpoint
  // refuses `recovery`, and this one refuses everything else. A `signup`
  // token redeemed here would reach `/reset-password` holding a session,
  // which is the one page that lets a password be set without knowing the
  // old one.
  it.each(["signup", "magiclink", "invite", "email_change", "email"])(
    "refuses OTP type %s",
    (type) => {
      const result = parseRecoveryParams(
        params({ token_hash: VALID_HASH, type }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(type);
      }
    },
  );

  it("ignores a `next` parameter entirely", () => {
    // There is no caller-chosen destination on this endpoint by design —
    // a recovery token mints a session, so an attacker-supplied `next`
    // would be an open redirect that arrives authenticated.
    const result = parseRecoveryParams(
      params({
        token_hash: VALID_HASH,
        type: "recovery",
        next: "https://evil.example",
      }),
    );
    expect(result).toEqual({
      ok: true,
      tokenHash: VALID_HASH,
      type: "recovery",
    });
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });

  it("only ever lands on a same-origin path that demands a new password", () => {
    expect(RECOVERY_NEXT_PATH).toBe("/reset-password");
    expect(new URL(RECOVERY_NEXT_PATH, "https://vokr.shop").origin).toBe(
      "https://vokr.shop",
    );
  });

  it("keeps the rejection reason log-only and stringly typed", () => {
    expect(parseRecoveryParams(params({ type: RECOVERY_OTP_TYPE }))).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });
});
