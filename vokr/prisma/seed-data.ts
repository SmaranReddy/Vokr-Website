/**
 * The five launch SKUs (§3.6) and the upsert logic that seeds them.
 * Shared by the CLI entrypoint (`prisma/seed.ts`) and the integration
 * test (`prisma/__tests__/catalog.integration.test.ts`) so both run the
 * exact same seeding code rather than two copies that can drift.
 *
 * See `prisma/seed.ts` for why GST/HSN are left NULL, why every variant
 * seeds as "draft", and why the weight figures are placeholders.
 */

import type { PrismaClient } from "../src/generated/prisma/client";
import { CatalogStatus } from "../src/generated/prisma/enums";

export interface VariantSeed {
  id: string;
  sku: string;
  sizeLabel: string;
  colorway: string;
  weightGrams: number;
  position: number;
}

export interface ProductSeed {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  pricePaise: number;
  variants: VariantSeed[];
}

const IN_ADULT_SIZES = [4, 5, 6, 7, 8, 9, 10, 11];
/** Matches §3.6's own "IN 10, 11, 12, 13, 1, 2, 3" ordering — not a typo. */
const IN_KIDS_SIZES = [10, 11, 12, 13, 1, 2, 3];

function withIds(
  variants: Omit<VariantSeed, "id">[],
  ids: string[],
): VariantSeed[] {
  if (variants.length !== ids.length) {
    throw new Error(
      `Seed misconfiguration: ${variants.length} variants but ${ids.length} fixed ids provided.`,
    );
  }
  return variants.map((variant, index) => ({ ...variant, id: ids[index]! }));
}

function adultSizeVariants(
  skuPrefix: string,
  colorwayCode: string,
  colorway: string,
  weightGrams: number,
): Omit<VariantSeed, "id">[] {
  return IN_ADULT_SIZES.map((size, index) => ({
    sku: `${skuPrefix}-${colorwayCode}-IN${String(size).padStart(2, "0")}`,
    sizeLabel: `IN ${size}`,
    colorway,
    weightGrams,
    position: index,
  }));
}

// Fixed UUIDv7s generated once for this seed. Stable across every
// environment this script runs against — never regenerate these.
export const PRODUCTS: ProductSeed[] = [
  {
    id: "01a07f95-a22d-74c0-a99e-58ef77a67c2f",
    slug: "model-x",
    name: "Model x",
    description: "Vokr's flagship sneaker.",
    category: "footwear",
    pricePaise: 999_500,
    variants: withIds(
      adultSizeVariants("VK-MX", "WHTBLK", "White & Black", 900),
      [
        "01a07f95-a22e-78b5-80fb-e470c9188fb8",
        "01a07f95-a22e-78b5-80fb-e47151219d57",
        "01a07f95-a22e-78b5-80fb-e472a8e28e7a",
        "01a07f95-a22e-78b5-80fb-e473cfce5269",
        "01a07f95-a22e-78b5-80fb-e474a19057a5",
        "01a07f95-a22f-74f8-bc6c-e39efee29b81",
        "01a07f95-a22f-74f8-bc6c-e39fd28c5ce6",
        "01a07f95-a22f-74f8-bc6c-e3a0e7b88171",
      ],
    ),
  },
  {
    id: "01a07f95-a22f-74f8-bc6c-e3a178cc35ec",
    slug: "model-001",
    name: "Model 001",
    description: "Vokr's everyday sneaker.",
    category: "footwear",
    pricePaise: 899_500,
    variants: withIds(adultSizeVariants("VK-M001", "STD", "Standard", 850), [
      "01a07f95-a22f-74f8-bc6c-e3a295ec33ec",
      "01a07f95-a22f-74f8-bc6c-e3a3c5b3c2a2",
      "01a07f95-a22f-74f8-bc6c-e3a4336256a5",
      "01a07f95-a22f-74f8-bc6c-e3a55f9e5c81",
      "01a07f95-a22f-74f8-bc6c-e3a67079bfeb",
      "01a07f95-a22f-74f8-bc6c-e3a7909ec780",
      "01a07f95-a22f-74f8-bc6c-e3a87617ba9b",
      "01a07f95-a22f-74f8-bc6c-e3a9de1e785c",
    ]),
  },
  {
    id: "01a07f95-a22f-74f8-bc6c-e3aa761705f4",
    slug: "kids-model-123",
    name: "Kids Model 123",
    description: "Vokr's kids' sneaker. Sold as an adult-purchased item only.",
    category: "kids-footwear",
    pricePaise: 599_500,
    variants: withIds(
      IN_KIDS_SIZES.map((size, index) => ({
        sku: `VK-KM123-STD-IN${String(size).padStart(2, "0")}`,
        sizeLabel: `IN ${size}`,
        colorway: "Standard",
        weightGrams: 500,
        position: index,
      })),
      [
        "01a07f95-a22f-74f8-bc6c-e3abebb25fb6",
        "01a07f95-a22f-74f8-bc6c-e3ac3573076e",
        "01a07f95-a22f-74f8-bc6c-e3aded8f3cff",
        "01a07f95-a22f-74f8-bc6c-e3ae9c430ff9",
        "01a07f95-a22f-74f8-bc6c-e3af9f56f338",
        "01a07f95-a22f-74f8-bc6c-e3b08a534c35",
        "01a07f95-a22f-74f8-bc6c-e3b1a406eb52",
      ],
    ),
  },
  {
    id: "01a07f95-a22f-74f8-bc6c-e3b2c805a12b",
    slug: "socks",
    name: "Vokr Socks",
    description: "Vokr's 3-pack of socks.",
    category: "accessories",
    pricePaise: 49_500,
    variants: withIds(
      [
        {
          sku: "VK-SOCK-STD-SM",
          sizeLabel: "S/M",
          colorway: "Standard",
          weightGrams: 100,
          position: 0,
        },
        {
          sku: "VK-SOCK-STD-ML",
          sizeLabel: "M/L",
          colorway: "Standard",
          weightGrams: 100,
          position: 1,
        },
        {
          sku: "VK-SOCK-STD-LXL",
          sizeLabel: "L/XL",
          colorway: "Standard",
          weightGrams: 100,
          position: 2,
        },
      ],
      [
        "01a07f95-a22f-74f8-bc6c-e3b3b2b34b2d",
        "01a07f95-a22f-74f8-bc6c-e3b43fe67f05",
        "01a07f95-a22f-74f8-bc6c-e3b5c048e6e9",
      ],
    ),
  },
  {
    id: "01a07f95-a22f-74f8-bc6c-e3b658bbdf5d",
    slug: "stretch-laces",
    name: "Stretch Laces",
    description: "Vokr's stretch laces.",
    category: "accessories",
    pricePaise: 29_500,
    variants: withIds(
      [
        {
          sku: "VK-LACE-STD-OS",
          sizeLabel: "One Size",
          colorway: "Standard",
          weightGrams: 30,
          position: 0,
        },
      ],
      ["01a07f95-a22f-74f8-bc6c-e3b7eb726404"],
    ),
  },
];

export interface SeedResult {
  productCount: number;
  variantCount: number;
  inventoryCount: number;
}

export async function seedCatalog(prisma: PrismaClient): Promise<SeedResult> {
  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        name: product.name,
        description: product.description,
        category: product.category,
        status: CatalogStatus.active,
      },
      create: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        category: product.category,
        status: CatalogStatus.active,
        // gstRateBps and hsnCode intentionally omitted — NULL until D2.
      },
    });

    for (const variant of product.variants) {
      await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        update: {
          sizeLabel: variant.sizeLabel,
          colorway: variant.colorway,
          pricePaise: product.pricePaise,
          weightGrams: variant.weightGrams,
          position: variant.position,
        },
        create: {
          id: variant.id,
          productId: product.id,
          sku: variant.sku,
          sizeLabel: variant.sizeLabel,
          colorway: variant.colorway,
          pricePaise: product.pricePaise,
          weightGrams: variant.weightGrams,
          position: variant.position,
          status: CatalogStatus.draft,
          inventory: {
            create: {
              quantityOnHand: 0,
              quantityReserved: 0,
            },
          },
        },
      });
    }
  }

  const [productCount, variantCount, inventoryCount] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.inventory.count(),
  ]);

  return { productCount, variantCount, inventoryCount };
}
