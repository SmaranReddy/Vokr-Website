import { describe, expect, it } from "vitest";

import { generateGuestToken, hashGuestToken } from "@/server/auth/tokens";

describe("generateGuestToken", () => {
  it("returns 64 lowercase hex characters (256 bits)", () => {
    expect(generateGuestToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats across calls", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateGuestToken()),
    );
    expect(tokens.size).toBe(100);
  });
});

describe("hashGuestToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateGuestToken();
    expect(hashGuestToken(token)).toBe(hashGuestToken(token));
  });

  it("differs for different tokens", () => {
    expect(hashGuestToken(generateGuestToken())).not.toBe(
      hashGuestToken(generateGuestToken()),
    );
  });

  it("never equals the raw token", () => {
    const token = generateGuestToken();
    expect(hashGuestToken(token)).not.toBe(token);
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    expect(hashGuestToken(generateGuestToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});
