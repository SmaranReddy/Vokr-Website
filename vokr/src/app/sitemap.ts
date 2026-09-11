import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { MARKETING_ROUTES, SHOP_SLUGS } from "@/config/nav";

/**
 * Generated from the real route list (Phase 4 task 11) — not a
 * hand-maintained copy of the legacy site's structure. `gift-cards.html`
 * is absent because it was never migrated (D1, §2A.6); `search`, `cart`
 * and the auth routes are intentionally excluded as non-canonical
 * utility pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const marketing = MARKETING_ROUTES.map((route) => ({
    url: `${siteConfig.url}${route}`,
  }));
  const shop = SHOP_SLUGS.map((slug) => ({
    url: `${siteConfig.url}/shop/${slug}`,
  }));
  return [...marketing, ...shop];
}
