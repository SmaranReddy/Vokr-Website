import { describe, expect, it, vi, beforeEach } from "vitest";

import { NotFoundError } from "@/lib/errors";

const findManyMock = vi.fn();

vi.mock("@/server/db/client", () => ({
  prisma: {
    product: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

// Imported after the mock so the module under test picks up the mocked client.
const {
  listProducts,
  getProductBySlug,
  getVariantById,
  resolvePrices,
  invalidateCatalogCache,
} = await import("../service");

/** A product with one purchasable variant and one still gated on D2. */
function fixtureProducts() {
  return [
    {
      id: "product-1",
      slug: "model-x",
      name: "Model x",
      description: "desc",
      category: "footwear",
      hsnCode: "6404",
      gstRateBps: 1800,
      variants: [
        {
          id: "variant-active",
          sku: "VK-MX-WHTBLK-IN09",
          sizeLabel: "IN 9",
          colorway: "White & Black",
          pricePaise: 999_500,
          weightGrams: 900,
          position: 0,
          status: "active",
          inventory: { quantityOnHand: 10, quantityReserved: 3 },
        },
        {
          id: "variant-draft",
          sku: "VK-MX-WHTBLK-IN10",
          sizeLabel: "IN 10",
          colorway: "White & Black",
          pricePaise: 999_500,
          weightGrams: 900,
          position: 1,
          status: "draft",
          inventory: { quantityOnHand: 5, quantityReserved: 0 },
        },
      ],
    },
  ];
}

beforeEach(() => {
  findManyMock.mockReset();
  invalidateCatalogCache();
});

describe("catalog service", () => {
  it("listProducts issues exactly one query per cache miss and shapes the DTO", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());

    const products = await listProducts();

    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(products).toHaveLength(1);
    expect(products[0]!.variants).toEqual([
      {
        id: "variant-active",
        sku: "VK-MX-WHTBLK-IN09",
        sizeLabel: "IN 9",
        colorway: "White & Black",
        pricePaise: 999_500,
        weightGrams: 900,
        position: 0,
        quantityAvailable: 7,
        isPurchasable: true,
      },
      {
        id: "variant-draft",
        sku: "VK-MX-WHTBLK-IN10",
        sizeLabel: "IN 10",
        colorway: "White & Black",
        pricePaise: 999_500,
        weightGrams: 900,
        position: 1,
        quantityAvailable: 5,
        isPurchasable: false,
      },
    ]);
  });

  it("getProductBySlug returns the matching product from the cached catalog", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());

    const product = await getProductBySlug("model-x");
    expect(product.slug).toBe("model-x");
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("getProductBySlug throws NotFoundError for an unknown slug", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await expect(getProductBySlug("does-not-exist")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("getVariantById resolves a known, purchasable variant", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    const variant = await getVariantById("variant-active");
    expect(variant.pricePaise).toBe(999_500);
  });

  it("getVariantById throws NotFoundError for an unknown variant id", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await expect(getVariantById("does-not-exist")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("getVariantById throws NotFoundError for a variant that exists but is not yet purchasable (D2 unresolved)", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await expect(getVariantById("variant-draft")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("resolvePrices returns the seeded price for a known, purchasable variant id", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    const prices = await resolvePrices(["variant-active"]);
    expect(prices.get("variant-active")).toBe(999_500);
  });

  it("resolvePrices throws for an unknown variant id and resolves nothing partially", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await expect(
      resolvePrices(["variant-active", "does-not-exist"]),
    ).rejects.toThrow(NotFoundError);
  });

  it("resolvePrices throws for a variant not yet purchasable, exactly like an unknown one", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await expect(resolvePrices(["variant-draft"])).rejects.toThrow(
      NotFoundError,
    );
  });

  it("serves repeated calls from the 60s cache without re-querying", async () => {
    findManyMock.mockResolvedValue(fixtureProducts());
    await listProducts();
    await getProductBySlug("model-x");
    await getVariantById("variant-active");
    await resolvePrices(["variant-active"]);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });
});
