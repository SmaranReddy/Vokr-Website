import manifest from "@/config/image-manifest.json";
import { clientEnv } from "@/lib/env-client";

/**
 * Storefront photographs (plan §5 Phase 14, R21). With
 * `NEXT_PUBLIC_ASSET_BASE_URL` unset, every image keeps its legacy
 * `cdn.shopify.com` URL exactly as today. Set to `/img` (the copies in
 * `public/img`) or the R2 asset domain, each image becomes AVIF + WebP at
 * pre-generated widths (`scripts/assets/build-images.ts`), content-hashed so
 * they cache forever.
 */
export type ImageId = keyof typeof manifest;

interface ManifestEntry {
  hash: string;
  width: number;
  height: number;
  widths: number[];
}

export interface ResponsiveSources {
  /** `<source type="image/avif">` srcset, or null when serving the legacy URL. */
  avif: string | null;
  webp: string | null;
  /** The `<img src>`: the largest WebP, or the legacy URL. */
  src: string;
  width?: number;
  height?: number;
}

/** Each legacy Shopify URL → the manifest image made from it (`scripts/assets/sources.ts`). */
const LEGACY_URL_IDS: Record<string, ImageId> = {
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639": "model-x-white-black-side",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540": "model-001-black-side",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772": "white-side",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/Antimicrobial_lining.jpg?v=1777482622": "antimicrobial-lining",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/LACES2.jpg?v=1777579071": "stretch-laces",
};

export function imageIdForLegacyUrl(url: string): ImageId | undefined {
  return LEGACY_URL_IDS[url];
}

export function assetBaseUrl(raw: string | undefined = clientEnv.NEXT_PUBLIC_ASSET_BASE_URL): string | null {
  const base = raw?.trim().replace(/\/+$/, "");
  return base ? base : null;
}

export function imageFileName(id: string, hash: string, width: number, format: "avif" | "webp"): string {
  return `${id}-${hash}-${width}.${format}`;
}

export function responsiveSources(id: ImageId | undefined, legacyUrl: string, base: string | null = assetBaseUrl()): ResponsiveSources {
  const entry = id === undefined ? undefined : (manifest as Record<string, ManifestEntry>)[id];
  if (!base || !entry || id === undefined) return { avif: null, webp: null, src: legacyUrl };
  const set = (format: "avif" | "webp") =>
    entry.widths.map((w) => `${base}/${imageFileName(id, entry.hash, w, format)} ${w}w`).join(", ");
  const largest = entry.widths[entry.widths.length - 1]!;
  return {
    avif: set("avif"),
    webp: set("webp"),
    src: `${base}/${imageFileName(id, entry.hash, largest, "webp")}`,
    width: entry.width,
    height: entry.height,
  };
}
