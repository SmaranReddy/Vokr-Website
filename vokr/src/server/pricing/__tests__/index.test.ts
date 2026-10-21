import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ValidationError } from "@/lib/errors";

const cartItemFindManyMock = vi.fn();
vi.mock("@/server/db/client", () => ({
  prisma: { cartItem: { findMany: (...args: unknown[]) => cartItemFindManyMock(...args) } },
}));

const listProductsMock = vi.fn();
vi.mock("@/server/catalog", () => ({
  listProducts: (...args: unknown[]) => listProductsMock(...args),
}));

const getSellerStateMock = vi.fn();
const getFlatShippingFeePaiseMock = vi.fn();
const getCodHandlingFeePaiseMock = vi.fn();
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    getSellerState: (...args: unknown[]) => getSellerStateMock(...args),
    getFlatShippingFeePaise: (...args: unknown[]) => getFlatShippingFeePaiseMock(...args),
    getCodHandlingFeePaise: (...args: unknown[]) => getCodHandlingFeePaiseMock(...args),
  };
});

const { computePricing } = await import("../index");

/** One product taxed at 18% (footwear) and one at 5% (accessories) — mixed slabs, plan §5 Phase 6 testing requirements. */
function fixtureCatalog() {
  return [
    {
      id: "product-shoes",
      slug: "model-x",
      name: "Model x",
      description: "d",
      category: "footwear",
      hsnCode: "6404",
      gstRateBps: 1800,
      variants: [
        {
          id: "variant-shoes",
          sku: "VK-MX-WHTBLK-IN09",
          sizeLabel: "IN 9",
          colorway: "White & Black",
          pricePaise: 999_500,
          weightGrams: 900,
          position: 0,
          quantityAvailable: 5,
          isPurchasable: true,
        },
      ],
    },
    {
      id: "product-laces",
      slug: "stretch-laces",
      name: "Stretch Laces",
      description: "d",
      category: "accessories",
      hsnCode: "6406",
      gstRateBps: 500,
      variants: [
        {
          id: "variant-laces",
          sku: "VK-SL-BLK-OS",
          sizeLabel: "One Size",
          colorway: "Black",
          pricePaise: 29_500,
          weightGrams: 20,
          position: 0,
          quantityAvailable: 20,
          isPurchasable: true,
        },
      ],
    },
  ];
}

beforeEach(() => {
  cartItemFindManyMock.mockReset();
  listProductsMock.mockReset();
  getSellerStateMock.mockReset().mockReturnValue("Maharashtra");
  getFlatShippingFeePaiseMock.mockReset().mockReturnValue(9_900);
  getCodHandlingFeePaiseMock.mockReset().mockReturnValue(4_900);
});

describe("computePricing (plan §5 Phase 6, task 5)", () => {
  it("prices a mixed-GST-slab cart, intra-state (CGST+SGST), below the free-shipping threshold, prepaid", async () => {
    cartItemFindManyMock.mockResolvedValue([
      { variantId: "variant-shoes", quantity: 1 },
      { variantId: "variant-laces", quantity: 2 },
    ]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const snapshot = await computePricing({
      cartId: "cart-1",
      shipToState: "Maharashtra",
      paymentMethod: "prepaid",
    });

    expect(snapshot.gstSplit).toBe("intra_state");

    const shoesLine = snapshot.lines.find((l) => l.variantId === "variant-shoes")!;
    // 999500 * 1800 / 11800 = 152466.10... -> half-up 152466.
    expect(shoesLine.lineTaxPaise).toBe(152_466);
    expect(shoesLine.cgstPaise + shoesLine.sgstPaise).toBe(shoesLine.lineTaxPaise);
    expect(shoesLine.igstPaise).toBe(0);
    expect(shoesLine.cgstPaise).toBe(76_233);
    expect(shoesLine.sgstPaise).toBe(76_233);

    const lacesLine = snapshot.lines.find((l) => l.variantId === "variant-laces")!;
    // (29500 * 2 = 59000) * 500 / 10500 = 2809.52... -> half-up 2810. Odd split: floor/remainder.
    expect(lacesLine.lineTaxPaise).toBe(2_810);
    expect(lacesLine.cgstPaise).toBe(1_405);
    expect(lacesLine.sgstPaise).toBe(1_405);
    expect(lacesLine.cgstPaise + lacesLine.sgstPaise).toBe(lacesLine.lineTaxPaise);

    expect(snapshot.subtotalPaise).toBe(999_500 + 59_000);
    expect(snapshot.taxPaise).toBe(152_466 + 2_810);
    // Below the ₹4,999 threshold's *complement* — this subtotal is well above it, so shipping is free.
    expect(snapshot.shippingPaise).toBe(0);
    expect(snapshot.codFeePaise).toBe(0);
    expect(snapshot.totalPaise).toBe(snapshot.subtotalPaise);
  });

  it("charges the flat shipping fee at or below the ₹4,999 threshold, and free strictly above it", async () => {
    listProductsMock.mockResolvedValue(fixtureCatalog());

    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-laces", quantity: 1 }]);
    const below = await computePricing({
      cartId: "cart-below",
      shipToState: "Maharashtra",
      paymentMethod: "prepaid",
    });
    expect(below.subtotalPaise).toBeLessThan(499_900);
    expect(below.shippingPaise).toBe(9_900);

    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-shoes", quantity: 1 }]);
    const above = await computePricing({
      cartId: "cart-above",
      shipToState: "Maharashtra",
      paymentMethod: "prepaid",
    });
    expect(above.subtotalPaise).toBeGreaterThan(499_900);
    expect(above.shippingPaise).toBe(0);
  });

  it("adds the COD handling fee only for paymentMethod=cod", async () => {
    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-laces", quantity: 1 }]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const cod = await computePricing({
      cartId: "cart-cod",
      shipToState: "Maharashtra",
      paymentMethod: "cod",
    });
    expect(cod.codFeePaise).toBe(4_900);
    expect(cod.totalPaise).toBe(cod.subtotalPaise + cod.shippingPaise + 4_900);
  });

  it("splits inter-state as IGST only, with CGST/SGST both zero", async () => {
    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-shoes", quantity: 1 }]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const snapshot = await computePricing({
      cartId: "cart-inter",
      shipToState: "Karnataka",
      paymentMethod: "prepaid",
    });

    expect(snapshot.gstSplit).toBe("inter_state");
    const line = snapshot.lines[0]!;
    expect(line.igstPaise).toBe(line.lineTaxPaise);
    expect(line.cgstPaise).toBe(0);
    expect(line.sgstPaise).toBe(0);
  });

  it("rounding invariant: CGST+SGST (or IGST alone) always sums to exactly lineTaxPaise, for adversarial price/rate/quantity combinations", async () => {
    const adversarial: Array<{ pricePaise: number; gstRateBps: number; quantity: number }> = [
      { pricePaise: 1, gstRateBps: 1800, quantity: 1 },
      { pricePaise: 333, gstRateBps: 1250, quantity: 7 },
      { pricePaise: 999_999, gstRateBps: 500, quantity: 3 },
      { pricePaise: 100, gstRateBps: 100, quantity: 9 },
      { pricePaise: 123_456, gstRateBps: 1800, quantity: 5 },
    ];

    for (const [i, params] of adversarial.entries()) {
      const catalog = [
        {
          id: `product-${i}`,
          slug: `product-${i}`,
          name: `Product ${i}`,
          description: "d",
          category: "test",
          hsnCode: "0000",
          gstRateBps: params.gstRateBps,
          variants: [
            {
              id: `variant-${i}`,
              sku: `SKU-${i}`,
              sizeLabel: "One Size",
              colorway: "Test",
              pricePaise: params.pricePaise,
              weightGrams: 100,
              position: 0,
              quantityAvailable: 100,
              isPurchasable: true,
            },
          ],
        },
      ];
      listProductsMock.mockResolvedValue(catalog);

      for (const shipToState of ["Maharashtra", "Karnataka"]) {
        cartItemFindManyMock.mockResolvedValue([
          { variantId: `variant-${i}`, quantity: params.quantity },
        ]);
        const snapshot = await computePricing({
          cartId: `cart-adversarial-${i}-${shipToState}`,
          shipToState,
          paymentMethod: "prepaid",
        });
        const line = snapshot.lines[0]!;
        expect(line.cgstPaise + line.sgstPaise + line.igstPaise).toBe(line.lineTaxPaise);
        expect(snapshot.taxPaise).toBe(line.lineTaxPaise);
      }
    }
  });

  it("rejects an empty cart", async () => {
    cartItemFindManyMock.mockResolvedValue([]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    await expect(
      computePricing({ cartId: "cart-empty", shipToState: "Maharashtra", paymentMethod: "prepaid" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a cart line whose variant is no longer purchasable, or has insufficient stock", async () => {
    listProductsMock.mockResolvedValue(fixtureCatalog());

    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-gone", quantity: 1 }]);
    await expect(
      computePricing({ cartId: "cart-gone", shipToState: "Maharashtra", paymentMethod: "prepaid" }),
    ).rejects.toThrow(ConflictError);

    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-shoes", quantity: 999 }]);
    await expect(
      computePricing({ cartId: "cart-oos", shipToState: "Maharashtra", paymentMethod: "prepaid" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("computePricing — first-order discount (owner decision, 21 Oct 2026)", () => {
  it("takes 10% off each line in whole rupees and charges GST on the discounted lines", async () => {
    cartItemFindManyMock.mockResolvedValue([
      { variantId: "variant-shoes", quantity: 1 },
      { variantId: "variant-laces", quantity: 2 },
    ]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const snapshot = await computePricing({
      cartId: "cart-1",
      shipToState: "Karnataka",
      paymentMethod: "prepaid",
      firstOrderDiscount: true,
    });

    const shoes = snapshot.lines.find((l) => l.variantId === "variant-shoes")!;
    // 10% of ₹9,995 = ₹999.50 -> half-up to whole rupees ₹1,000.
    expect(shoes.lineDiscountPaise).toBe(100_000);
    expect(shoes.lineSubtotalPaise).toBe(999_500);
    // (999500 - 100000) * 1800 / 11800 = 137211.86 -> 137212, all IGST (inter-state).
    expect(shoes.lineTaxPaise).toBe(137_212);
    expect(shoes.igstPaise).toBe(137_212);

    const laces = snapshot.lines.find((l) => l.variantId === "variant-laces")!;
    // 10% of ₹590 = ₹59.
    expect(laces.lineDiscountPaise).toBe(5_900);
    // 53100 * 500 / 10500 = 2528.57 -> 2529.
    expect(laces.lineTaxPaise).toBe(2_529);

    expect(snapshot.discount).toEqual({ kind: "first_order", rateBps: 1000 });
    expect(snapshot.discountPaise).toBe(105_900);
    expect(snapshot.taxPaise).toBe(137_212 + 2_529);
    expect(snapshot.shippingPaise).toBe(0);
    expect(snapshot.totalPaise).toBe(999_500 + 59_000 - 105_900);
  });

  it("judges free shipping on the subtotal after the discount, and never discounts shipping or the COD fee", async () => {
    const catalog = fixtureCatalog();
    catalog[0]!.variants[0]!.pricePaise = 510_000; // ₹5,100: over ₹4,999, but ₹4,590 after 10%.
    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-shoes", quantity: 1 }]);
    listProductsMock.mockResolvedValue(catalog);

    const discounted = await computePricing({
      cartId: "cart-1",
      shipToState: "Maharashtra",
      paymentMethod: "cod",
      firstOrderDiscount: true,
    });
    expect(discounted.discountPaise).toBe(51_000);
    expect(discounted.shippingPaise).toBe(9_900);
    expect(discounted.codFeePaise).toBe(4_900);
    expect(discounted.totalPaise).toBe(510_000 - 51_000 + 9_900 + 4_900);

    const full = await computePricing({ cartId: "cart-1", shipToState: "Maharashtra", paymentMethod: "cod" });
    expect(full.shippingPaise).toBe(0);
  });

  it("applies nothing when the phone has already had its first order", async () => {
    cartItemFindManyMock.mockResolvedValue([{ variantId: "variant-shoes", quantity: 1 }]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const snapshot = await computePricing({
      cartId: "cart-1",
      shipToState: "Maharashtra",
      paymentMethod: "prepaid",
      firstOrderDiscount: false,
    });
    expect(snapshot.discount).toBeNull();
    expect(snapshot.discountPaise).toBe(0);
    expect(snapshot.lines[0]!.lineDiscountPaise).toBe(0);
    expect(snapshot.lines[0]!.lineTaxPaise).toBe(152_466);
    expect(snapshot.totalPaise).toBe(999_500);
  });
});
