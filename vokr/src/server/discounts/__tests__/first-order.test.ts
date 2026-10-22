import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { claimFirstOrderDiscount, isFirstOrder, lineDiscountPaise, releaseFirstOrderDiscount } from "../first-order";

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

const CUSTOMER = {
  phone: "+919876543210",
  email: "Asha@Example.com",
  name: "Asha Rao",
  line1: "12, MG Road",
  pincode: "500001",
};

describe("discount keys", () => {
  it("are stable across encryptions, keyed, and never contain the value", async () => {
    const { encryptField, discountKeysFromEncrypted, discountKeys } = await withKey(randomBytes(32).toString("base64"));
    const fromPlain = discountKeys(CUSTOMER);
    const fromEncrypted = discountKeysFromEncrypted({
      phoneEnc: encryptField(CUSTOMER.phone),
      contactEmailEnc: encryptField(CUSTOMER.email),
      nameEnc: encryptField(CUSTOMER.name),
      line1Enc: encryptField(CUSTOMER.line1),
      pincode: CUSTOMER.pincode,
    });
    expect(fromEncrypted).toEqual(fromPlain);
    expect(fromPlain.map((key) => key.kind)).toEqual(["phone", "email", "name_address"]);
    for (const key of fromPlain) {
      expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(key.hash).not.toContain("9876543210");
    }
  });

  it("match the same customer through case, spacing and punctuation", async () => {
    const { discountKeys } = await withKey(randomBytes(32).toString("base64"));
    const again = discountKeys({ ...CUSTOMER, email: " asha@example.com ", name: "ASHA  RAO", line1: "12 mg road." });
    expect(again).toEqual(discountKeys(CUSTOMER));
  });

  it("a new phone and email still match on name + address; a different address does not", async () => {
    const { discountKeys } = await withKey(randomBytes(32).toString("base64"));
    const base = discountKeys(CUSTOMER);
    const newContact = discountKeys({ ...CUSTOMER, phone: "+919876543211", email: "other@example.com" });
    expect(newContact[0]!.hash).not.toBe(base[0]!.hash);
    expect(newContact[1]!.hash).not.toBe(base[1]!.hash);
    expect(newContact[2]!.hash).toBe(base[2]!.hash);
    expect(discountKeys({ ...CUSTOMER, line1: "14 MG Road" })[2]!.hash).not.toBe(base[2]!.hash);
  });

  it("change with the key (an unkeyed hash of a 10-digit number could be enumerated)", async () => {
    const before = (await withKey(randomBytes(32).toString("base64"))).keyedLookupHash("phone:+919876543210");
    const after = (await withKey(randomBytes(32).toString("base64"))).keyedLookupHash("phone:+919876543210");
    expect(after).not.toBe(before);
  });
});

describe("lineDiscountPaise", () => {
  it.each([
    [699_900, 69_990], // Model x / Model 001 ₹6,999 -> ₹699.90 off
    [399_900, 39_990], // Kids ₹3,999 -> ₹399.90
    [99_900, 9_990], // Socks ₹999 -> ₹99.90
    [29_900, 2_990], // Laces ₹299 -> ₹29.90
    [1_399_800, 139_980], // two pairs -> ₹1,399.80
    [12_345, 1_234], // only a fraction of a paisa is ever dropped
  ])("10%% of %i paise is %i, to the paisa (no rounding)", (subtotal, expected) => {
    expect(lineDiscountPaise(subtotal, 1000)).toBe(expected);
  });

  it("is zero at a zero rate", () => {
    expect(lineDiscountPaise(699_900, 0)).toBe(0);
  });
});

describe("claims", () => {
  const keys = [
    { kind: "phone" as const, hash: "a".repeat(64) },
    { kind: "email" as const, hash: "b".repeat(64) },
  ];

  it("a customer is new only when none of their keys is claimed", async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const client = { firstOrderDiscountClaim: { count } } as never;
    expect(await isFirstOrder(client, keys)).toBe(true);
    expect(await isFirstOrder(client, keys)).toBe(false);
    expect(count.mock.calls[0]![0]).toEqual({
      where: { OR: [{ keyKind: "phone", keyHash: "a".repeat(64) }, { keyKind: "email", keyHash: "b".repeat(64) }] },
    });
  });

  it("a duplicate key is logged, never thrown — the capture must not roll back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tx = { $executeRaw: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) } as never;
    expect(await claimFirstOrderDiscount(tx, { keys, orderId: "o1" })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("releasing deletes only that order's claims", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = { firstOrderDiscountClaim: { deleteMany } } as never;
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await releaseFirstOrderDiscount(tx, "o1")).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { orderId: "o1" } });
  });
});
