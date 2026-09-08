import { NotFoundError } from "@/lib/errors";
import { CatalogStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/client";

import { TtlCache } from "./cache";

/** A sellable unit as exposed outside `src/server/catalog/`. */
export interface CatalogVariant {
  id: string;
  sku: string;
  sizeLabel: string;
  colorway: string;
  pricePaise: number;
  weightGrams: number;
  position: number;
  quantityAvailable: number;
  /**
   * `true` only when the variant's own status is `active` *and* its
   * parent product has a confirmed GST rate — the database trigger
   * `enforce_variant_gst_rate` makes the second half physically
   * impossible to violate (see the first migration). A product family
   * can be browsable while every one of its variants is still
   * unpurchasable, which is the expected state until decision D2 (GST
   * rate + HSN per SKU) is answered — see Vokr-Implementation-Plan.md
   * §0.3.
   */
  isPurchasable: boolean;
}

/** A product family as exposed outside `src/server/catalog/`. */
export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  hsnCode: string | null;
  gstRateBps: number | null;
  variants: CatalogVariant[];
}

const CATALOG_CACHE_TTL_MS = 60_000;
const CATALOG_CACHE_KEY = "catalog:published-products";

const catalogCache = new TtlCache<CatalogProduct[]>(CATALOG_CACHE_TTL_MS);

/**
 * The one query this module issues against Postgres. Every field is
 * named explicitly — never `SELECT *`, per AGENTS.md and
 * Vokr-Implementation-Plan.md §3.5, and enforced separately by
 * `src/server/catalog/__tests__/no-select-star.test.ts`.
 */
async function fetchPublishedCatalog(): Promise<CatalogProduct[]> {
  const products = await prisma.product.findMany({
    where: { status: CatalogStatus.active },
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      category: true,
      hsnCode: true,
      gstRateBps: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          sku: true,
          sizeLabel: true,
          colorway: true,
          pricePaise: true,
          weightGrams: true,
          position: true,
          status: true,
          inventory: {
            select: { quantityOnHand: true, quantityReserved: true },
          },
        },
      },
    },
  });

  return products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    hsnCode: product.hsnCode,
    gstRateBps: product.gstRateBps,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      sizeLabel: variant.sizeLabel,
      colorway: variant.colorway,
      pricePaise: variant.pricePaise,
      weightGrams: variant.weightGrams,
      position: variant.position,
      quantityAvailable: variant.inventory
        ? Math.max(
            0,
            variant.inventory.quantityOnHand -
              variant.inventory.quantityReserved,
          )
        : 0,
      isPurchasable: variant.status === CatalogStatus.active,
    })),
  }));
}

async function getPublishedCatalog(): Promise<CatalogProduct[]> {
  return catalogCache.get(CATALOG_CACHE_KEY, fetchPublishedCatalog);
}

/** Every published (`active`-status) product, each with all of its variants. */
export async function listProducts(): Promise<CatalogProduct[]> {
  return getPublishedCatalog();
}

/** Throws {@link NotFoundError} if `slug` names no published product. */
export async function getProductBySlug(slug: string): Promise<CatalogProduct> {
  const catalog = await getPublishedCatalog();
  const product = catalog.find((candidate) => candidate.slug === slug);
  if (!product) {
    throw new NotFoundError(`No product found for slug "${slug}".`);
  }
  return product;
}

/**
 * Throws {@link NotFoundError} for a variant that does not exist *or is
 * not currently purchasable* — from a caller's perspective the two cases
 * must be indistinguishable, so a variant with no confirmed GST rate
 * cannot leak a price or an existence signal through this path either.
 */
export async function getVariantById(
  variantId: string,
): Promise<CatalogVariant> {
  const catalog = await getPublishedCatalog();
  for (const product of catalog) {
    const variant = product.variants.find(
      (candidate) => candidate.id === variantId && candidate.isPurchasable,
    );
    if (variant) {
      return variant;
    }
  }
  throw new NotFoundError(
    `No purchasable variant found for id "${variantId}".`,
  );
}

/**
 * The only exported path to a price (R6). Resolves every requested
 * variant ID against the catalog cache and throws if any one of them is
 * missing or not currently purchasable — there is no partial-success
 * mode, because a caller (the future cart) must never silently drop a
 * line it could not price.
 */
export async function resolvePrices(
  variantIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const catalog = await getPublishedCatalog();
  const priceByVariantId = new Map<string, number>();
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variant.isPurchasable) {
        priceByVariantId.set(variant.id, variant.pricePaise);
      }
    }
  }

  const resolved = new Map<string, number>();
  for (const variantId of variantIds) {
    const price = priceByVariantId.get(variantId);
    if (price === undefined) {
      throw new NotFoundError(
        `No purchasable variant found for id "${variantId}".`,
      );
    }
    resolved.set(variantId, price);
  }
  return resolved;
}

/** Exposed for tests and for a future admin mutation (Phase 12) to call after writing. */
export function invalidateCatalogCache(): void {
  catalogCache.invalidate(CATALOG_CACHE_KEY);
}
