import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { claimFirstOrderDiscount, isFirstOrderPhone, lineDiscountPaise } from "../first-order";

const originalKey = process.env.ADDRESS_ENCRYPTION_KEY;

/** `@/lib/env` parses `process.env` once per module load, so each key state is a fresh import (as in crypto.test.ts). */
async function withKey(key: string) {
  vi.resetModules();
  process.env.ADDRESS_ENCRYPTION_KEY = key;
  const crypto = await import("@/server/checkout/crypto");
  const firstOrder = await import("../first-order");
  return { ...crypto, ...firstOrder };
}

afterAll(() => {
  if (originalKey === undefined) delete process.env.ADDRESS_ENCRYPTION_KEY;
  else process.env.ADDRESS_ENCRYPTION_KEY = originalKey;
  vi.resetModules();
});

describe("phone lookup hash", () => {
  it("is stable for one number across encryptions, distinct across numbers, and never the number itself", async () => {
    const { encryptField, phoneHashFromEncrypted } = await withKey(randomBytes(32).toString("base64"));
    const a1 = phoneHashFromEncrypted(encryptField("+919876543210"));
    const a2 = phoneHashFromEncrypted(encryptField("+919876543210"));
    const b = phoneHashFromEncrypted(encryptField("+919876543211"));
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(a1).not.toContain("9876543210");
  });

  it("changes with the key (an unkeyed hash of a 10-digit number could be enumerated)", async () => {
    const before = (await withKey(randomBytes(32).toString("base64"))).phoneLookupHash("+919876543210");
    const after = (await withKey(randomBytes(32).toString("base64"))).phoneLookupHash("+919876543210");
    expect(after).not.toBe(before);
  });
});

describe("lineDiscountPaise", () => {
  it.each([
    [699_900, 70_000], // Model x / Model 001 ₹6,999 -> ₹700 off
    [399_900, 40_000], // Kids ₹3,999 -> ₹400
    [99_900, 10_000], // Socks ₹999 -> ₹100
    [29_900, 3_000], // Laces ₹299 -> ₹30
    [1_399_800, 140_000], // two pairs
  ])("10%% of %i paise is %i, in whole rupees", (subtotal, expected) => {
    expect(lineDiscountPaise(subtotal, 1000)).toBe(expected);
    expect(expected % 100).toBe(0);
  });

  it("is zero at a zero rate", () => {
    expect(lineDiscountPaise(699_900, 0)).toBe(0);
  });
});

describe("claims", () => {
  it("a phone with no claim row is a first order", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ phoneHash: "x" });
    const client = { firstOrderDiscountClaim: { findUnique } } as never;
    expect(await isFirstOrderPhone(client, "x")).toBe(true);
    expect(await isFirstOrderPhone(client, "x")).toBe(false);
  });

  it("a duplicate claim is logged, never thrown — the capture must not roll back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tx = { $executeRaw: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) } as never;
    expect(await claimFirstOrderDiscount(tx, { phoneHash: "h", orderId: "o1" })).toBe(true);
    expect(await claimFirstOrderDiscount(tx, { phoneHash: "h", orderId: "o2" })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
