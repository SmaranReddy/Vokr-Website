import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Identity } from "@/server/auth/session";

const cartFindFirstMock = vi.fn();
const cartItemFindManyMock = vi.fn();

vi.mock("@/server/db/client", () => ({
  prisma: {
    cart: { findFirst: (...args: unknown[]) => cartFindFirstMock(...args) },
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindManyMock(...args),
    },
  },
}));

const listProductsMock = vi.fn();
const getVariantByIdMock = vi.fn();

vi.mock("@/server/catalog", () => ({
  listProducts: (...args: unknown[]) => listProductsMock(...args),
  getVariantById: (...args: unknown[]) => getVariantByIdMock(...args),
}));

// Imported after the mocks so the module under test picks them up.
const { getCart } = await import("../service");

const userIdentity: Identity = {
  type: "user",
  userId: "user-1",
  email: "a@example.com",
};

/** One product taxed at 18% (footwear) and one at 5% (accessories) — mixed slabs, as Phase 5's `Why It Exists` demands. */
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
  cartFindFirstMock.mockReset();
  cartItemFindManyMock.mockReset();
  listProductsMock.mockReset();
  getVariantByIdMock.mockReset();
});

describe("cart service — getCart totals and per-line GST (plan §5 Phase 5, task 3)", () => {
  it("computes independent per-line GST for a mixed-slab cart, and a subtotal-equals-total (GST-inclusive) sum", async () => {
    cartFindFirstMock.mockResolvedValue({ id: "cart-1" });
    cartItemFindManyMock.mockResolvedValue([
      { id: "item-shoes", variantId: "variant-shoes", quantity: 1 },
      { id: "item-laces", variantId: "variant-laces", quantity: 2 },
    ]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const cart = await getCart(userIdentity);

    expect(cart.cartId).toBe("cart-1");
    expect(cart.items).toHaveLength(2);

    const shoesLine = cart.items.find((item) => item.variantId === "variant-shoes");
    // 999500 * 1800 / 11800 = 152466.10... -> half-up 152466.
    expect(shoesLine).toMatchObject({
      available: true,
      quantity: 1,
      lineSubtotalPaise: 999_500,
      gstRateBps: 1800,
      lineTaxPaise: 152_466,
      inStock: true,
    });

    const lacesLine = cart.items.find((item) => item.variantId === "variant-laces");
    // (29500 * 2 = 59000) * 500 / 10500 = 2809.52... -> half-up 2810.
    expect(lacesLine).toMatchObject({
      available: true,
      quantity: 2,
      lineSubtotalPaise: 59_000,
      gstRateBps: 500,
      lineTaxPaise: 2_810,
      inStock: true,
    });

    expect(cart.subtotalPaise).toBe(999_500 + 59_000);
    expect(cart.taxPaise).toBe(152_466 + 2_810);
    // GST-inclusive pricing (terms.html): nothing is added on top.
    expect(cart.totalPaise).toBe(cart.subtotalPaise);
  });

  it("marks a variant no longer in the published catalog as unavailable and excludes it from every total", async () => {
    cartFindFirstMock.mockResolvedValue({ id: "cart-1" });
    cartItemFindManyMock.mockResolvedValue([
      { id: "item-gone", variantId: "variant-removed", quantity: 1 },
    ]);
    listProductsMock.mockResolvedValue(fixtureCatalog());

    const cart = await getCart(userIdentity);

    expect(cart.items).toEqual([
      {
        cartItemId: "item-gone",
        variantId: "variant-removed",
        quantity: 1,
        available: false,
      },
    ]);
    expect(cart.subtotalPaise).toBe(0);
    expect(cart.taxPaise).toBe(0);
    expect(cart.totalPaise).toBe(0);
  });

  it("flags a line out of stock without altering the stored quantity or excluding it from totals", async () => {
    cartFindFirstMock.mockResolvedValue({ id: "cart-1" });
    cartItemFindManyMock.mockResolvedValue([
      { id: "item-shoes", variantId: "variant-shoes", quantity: 5 },
    ]);
    const catalog = fixtureCatalog();
    catalog[0]!.variants[0]!.quantityAvailable = 2; // fewer than the cart's quantity of 5
    listProductsMock.mockResolvedValue(catalog);

    const cart = await getCart(userIdentity);

    expect(cart.items[0]).toMatchObject({ quantity: 5, quantityAvailable: 2, inStock: false });
    expect(cart.subtotalPaise).toBe(999_500 * 5);
  });

  it("returns an empty view with no cart_items query when the identity has no open cart", async () => {
    cartFindFirstMock.mockResolvedValue(null);

    const cart = await getCart(userIdentity);

    expect(cart).toEqual({
      cartId: null,
      items: [],
      subtotalPaise: 0,
      taxPaise: 0,
      totalPaise: 0,
    });
    expect(cartItemFindManyMock).not.toHaveBeenCalled();
  });
});
