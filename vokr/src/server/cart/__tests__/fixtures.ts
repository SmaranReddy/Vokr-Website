import { randomUUID } from "node:crypto";

import { CatalogStatus } from "@/generated/prisma/enums";
import { invalidateCatalogCache } from "@/server/catalog";
import { prisma } from "@/server/db/client";

/**
 * Real seeded products are legitimately `draft` until decision D2 (GST
 * rate) is answered (see `prisma/seed-data.ts`), so cart integration
 * tests need their own active, priced, GST-rated fixtures — same
 * approach `src/server/catalog/__tests__/service.test.ts` takes at the
 * unit level, but against a real Postgres row here.
 */

export interface CartFixtureVariant {
  productId: string;
  variantId: string;
  sku: string;
  pricePaise: number;
  gstRateBps: number;
}

export async function createActiveVariantFixture(params: {
  name: string;
  category: string;
  gstRateBps: number;
  pricePaise: number;
  quantityOnHand?: number;
}): Promise<CartFixtureVariant> {
  const productId = randomUUID();
  const variantId = randomUUID();
  const slug = `test-${variantId}`;
  const sku = `TEST-${variantId.slice(0, 8).toUpperCase()}`;

  await prisma.product.create({
    data: {
      id: productId,
      slug,
      name: params.name,
      description: "Cart integration test fixture.",
      category: params.category,
      hsnCode: "0000",
      gstRateBps: params.gstRateBps,
      status: CatalogStatus.active,
    },
    select: { id: true },
  });

  await prisma.productVariant.create({
    data: {
      id: variantId,
      productId,
      sku,
      sizeLabel: "One Size",
      colorway: "Test",
      pricePaise: params.pricePaise,
      weightGrams: 100,
      position: 0,
      status: CatalogStatus.active,
    },
    select: { id: true },
  });

  await prisma.inventory.create({
    data: {
      variantId,
      quantityOnHand: params.quantityOnHand ?? 10,
      quantityReserved: 0,
    },
    select: { variantId: true },
  });

  invalidateCatalogCache();

  return {
    productId,
    variantId,
    sku,
    pricePaise: params.pricePaise,
    gstRateBps: params.gstRateBps,
  };
}

export async function deactivateVariantFixture(variantId: string): Promise<void> {
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { status: CatalogStatus.draft },
    select: { id: true },
  });
  invalidateCatalogCache();
}

export async function deleteVariantFixture(productId: string): Promise<void> {
  await prisma.inventory.deleteMany({ where: { variant: { productId } } });
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  invalidateCatalogCache();
}
