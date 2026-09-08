export type { CatalogProduct, CatalogVariant } from "./service";
export {
  listProducts,
  getProductBySlug,
  getVariantById,
  resolvePrices,
  invalidateCatalogCache,
} from "./service";
