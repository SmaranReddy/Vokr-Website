import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = [
  "CHECKOUT_SELLER_STATE",
  "CHECKOUT_FLAT_SHIPPING_FEE_PAISE",
  "CHECKOUT_COD_HANDLING_FEE_PAISE",
] as const;
const originalValues = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

async function importConfigWithEnv(
  overrides: Partial<Record<(typeof KEYS)[number], string | undefined>>,
): Promise<typeof import("../config")> {
  vi.resetModules();
  for (const key of KEYS) {
    const value = key in overrides ? overrides[key] : undefined;
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import("../config");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    const original = originalValues[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

/**
 * D3 (seller state) and D11 (shipping/COD fee amounts) are open
 * commercial decisions this codebase must not invent — same discipline
 * as `products.gst_rate_bps` (D2). Every getter here must fail loudly
 * when unset, never default silently.
 */
describe("pricing config — fail-loud on unanswered decisions (D3, D11)", () => {
  it("getSellerState throws when CHECKOUT_SELLER_STATE is unset", async () => {
    const { getSellerState } = await importConfigWithEnv({});
    expect(() => getSellerState()).toThrow(/CHECKOUT_SELLER_STATE is not set/);
  });

  it("getSellerState throws for a value outside the fixed GST state enumeration", async () => {
    const { getSellerState } = await importConfigWithEnv({
      CHECKOUT_SELLER_STATE: "Narnia",
    });
    expect(() => getSellerState()).toThrow(/not one of the fixed GST state enumeration/);
  });

  it("getSellerState returns the configured state when valid", async () => {
    const { getSellerState } = await importConfigWithEnv({
      CHECKOUT_SELLER_STATE: "Maharashtra",
    });
    expect(getSellerState()).toBe("Maharashtra");
  });

  it("getFlatShippingFeePaise throws when unset", async () => {
    const { getFlatShippingFeePaise } = await importConfigWithEnv({});
    expect(() => getFlatShippingFeePaise()).toThrow(/CHECKOUT_FLAT_SHIPPING_FEE_PAISE/);
  });

  it("getCodHandlingFeePaise throws when unset", async () => {
    const { getCodHandlingFeePaise } = await importConfigWithEnv({});
    expect(() => getCodHandlingFeePaise()).toThrow(/CHECKOUT_COD_HANDLING_FEE_PAISE/);
  });

  it("getFlatShippingFeePaise rejects a non-integer or negative value", async () => {
    const { getFlatShippingFeePaise: notInt } = await importConfigWithEnv({
      CHECKOUT_FLAT_SHIPPING_FEE_PAISE: "12.5",
    });
    expect(() => notInt()).toThrow(/non-negative integer/);

    const { getFlatShippingFeePaise: negative } = await importConfigWithEnv({
      CHECKOUT_FLAT_SHIPPING_FEE_PAISE: "-100",
    });
    expect(() => negative()).toThrow(/non-negative integer/);
  });
});
