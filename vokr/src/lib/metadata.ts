import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

/**
 * Builds page metadata consistent with the site-wide title template and
 * description fallback. Use from any page/layout that needs custom metadata.
 */
export function createMetadata(overrides: Metadata = {}): Metadata {
  return {
    title: siteConfig.name,
    description: siteConfig.description,
    metadataBase: new URL(siteConfig.url),
    ...overrides,
  };
}
