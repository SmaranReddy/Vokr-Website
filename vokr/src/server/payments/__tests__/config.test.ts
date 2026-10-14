import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = [
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

async function importWithEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  vi.resetModules();
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("../config");
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Razorpay config — test mode only", () => {
  it("ships with live mode disallowed", async () => {
    const config = await importWithEnv({});
    expect(config.RAZORPAY_LIVE_MODE_ALLOWED).toBe(false);
  });

  it("returns a test-mode key pair", async () => {
    const config = await importWithEnv({
      NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_abc123",
      RAZORPAY_KEY_SECRET: "fixture",
    });
    expect(config.requireRazorpayConfig()).toEqual({
      keyId: "rzp_test_abc123",
      keySecret: "fixture",
    });
  });

  it("refuses a live key, and never echoes the key", async () => {
    const config = await importWithEnv({
      NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_live_SECRETPART",
      RAZORPAY_KEY_SECRET: "fixture",
    });
    expect(() => config.requireRazorpayConfig()).toThrow(/not a test-mode key/);
    expect(() => config.requireRazorpayConfig()).not.toThrow(/SECRETPART/);
  });

  it("throws when unconfigured instead of defaulting", async () => {
    const config = await importWithEnv({});
    expect(() => config.requireRazorpayConfig()).toThrow(/not configured/);
    expect(config.getRazorpayWebhookSecret()).toBeUndefined();
  });
});
