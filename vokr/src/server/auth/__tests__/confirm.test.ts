import { describe, expect, it } from "vitest";

import {
  CONFIRMABLE_OTP_TYPES,
  DEFAULT_NEXT_PATH,
  parseConfirmParams,
  safeNextPath,
} from "@/server/auth/confirm";

const VALID_HASH = "pkce_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parseConfirmParams", () => {
  it("accepts a well-formed signup confirmation link", () => {
    const result = parseConfirmParams(
      params({ token_hash: VALID_HASH, type: "signup" }),
    );
    expect(result).toEqual({
      ok: true,
      tokenHash: VALID_HASH,
      type: "signup",
      next: DEFAULT_NEXT_PATH,
    });
  });

  it("carries a safe relative `next` through", () => {
    const result = parseConfirmParams(
      params({ token_hash: VALID_HASH, type: "signup", next: "/account" }),
    );
    expect(result).toMatchObject({ ok: true, next: "/account" });
  });

  it.each([
    ["missing token_hash", { type: "signup" }],
    ["missing type", { token_hash: VALID_HASH }],
    ["empty token_hash", { token_hash: "", type: "signup" }],
  ])("rejects a link with %s", (_label, entries) => {
    expect(parseConfirmParams(params(entries)).ok).toBe(false);
  });

  it.each([
    "not a hash!",
    "has space",
    "semi;colon",
    "slash/inside",
    "percent%20encoded",
  ])("rejects a malformed token_hash (%s)", (hash) => {
    expect(
      parseConfirmParams(params({ token_hash: hash, type: "signup" })).ok,
    ).toBe(false);
  });

  it("rejects a token_hash longer than the permitted length", () => {
    expect(
      parseConfirmParams(
        params({ token_hash: "a".repeat(257), type: "signup" }),
      ).ok,
    ).toBe(false);
  });

  // The security-critical case: a recovery token legitimately mints a
  // session, so accepting it here would turn any password-reset link into
  // a full sign-in that never sets a password. See `confirm.ts`.
  it.each(["recovery", "magiclink", "invite", "email_change", "email"])(
    "refuses to confirm OTP type %s",
    (type) => {
      const result = parseConfirmParams(
        params({ token_hash: VALID_HASH, type }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(type);
      }
    },
  );

  it("only permits the types named in CONFIRMABLE_OTP_TYPES", () => {
    expect([...CONFIRMABLE_OTP_TYPES]).toEqual(["signup"]);
    for (const type of CONFIRMABLE_OTP_TYPES) {
      expect(
        parseConfirmParams(params({ token_hash: VALID_HASH, type })).ok,
      ).toBe(true);
    }
  });

  it("does not leak the rejection reason into anything caller-visible", () => {
    // `reason` is log-only by contract; assert it exists and is a string so
    // a refactor cannot quietly start returning it as a user message field.
    const result = parseConfirmParams(params({ type: "signup" }));
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe("safeNextPath", () => {
  it("keeps an ordinary same-origin path", () => {
    expect(safeNextPath("/account/orders")).toBe("/account/orders");
  });

  it("keeps a path with a query string and fragment", () => {
    expect(safeNextPath("/shop?sort=new#top")).toBe("/shop?sort=new#top");
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash protocol-relative", "/\\evil.example"],
    ["absolute https", "https://evil.example"],
    ["absolute http", "http://evil.example/path"],
    ["scheme-only", "javascript:alert(1)"],
    ["bare word", "account"],
    ["empty", ""],
  ])("refuses an open redirect via %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_NEXT_PATH);
  });

  it.each([null, undefined])("falls back when next is %s", (raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_NEXT_PATH);
  });

  it("refuses a path carrying CR/LF, which must never reach a Location header", () => {
    expect(safeNextPath("/ok\r\nSet-Cookie: a=b")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/ok\nX-Injected: 1")).toBe(DEFAULT_NEXT_PATH);
  });

  it("resolves every accepted value to our own origin", () => {
    const origin = "https://vokr.shop";
    for (const raw of [
      "/account",
      "/shop?sort=new",
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
    ]) {
      expect(new URL(safeNextPath(raw), origin).origin).toBe(origin);
    }
  });
});
