import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "@/config/csp";
import manifest from "@/config/image-manifest.json";
import { assetBaseUrl, imageIdForLegacyUrl, responsiveSources, type ImageId } from "@/lib/images";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SHOPIFY = /https:\/\/cdn\.shopify\.com\/[^"'`\s)]+/g;

describe("responsive images (Phase 14, R21)", () => {
  it("unconfigured: every image keeps its legacy URL, untouched", () => {
    const legacy = "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/LACES2.jpg?v=1777579071";
    expect(responsiveSources("stretch-laces", legacy, null)).toEqual({ avif: null, webp: null, src: legacy });
    expect(assetBaseUrl(undefined)).toBeNull();
    expect(assetBaseUrl("")).toBeNull();
    expect(assetBaseUrl("  ")).toBeNull();
  });

  it("configured: AVIF and WebP srcsets at every manifest width, content-hashed", () => {
    const sources = responsiveSources("model-x-white-overhead", "https://cdn.shopify.com/x.jpg", assetBaseUrl("https://assets.vokr.shop/"));
    const entry = manifest["model-x-white-overhead"];
    expect(sources.avif?.split(", ")).toEqual(entry.widths.map((w) => `https://assets.vokr.shop/model-x-white-overhead-${entry.hash}-${w}.avif ${w}w`));
    expect(sources.webp).toContain(`model-x-white-overhead-${entry.hash}-${entry.widths.at(-1)}.webp`);
    expect(sources.src).toBe(`https://assets.vokr.shop/model-x-white-overhead-${entry.hash}-${entry.widths.at(-1)}.webp`);
    expect(sources).toMatchObject({ width: entry.width, height: entry.height });
    expect(responsiveSources("white-side", "x", "/img").src).toMatch(/^\/img\/white-side-[0-9a-f]{10}-\d+\.webp$/);
  });

  it("every cdn.shopify.com URL the storefront renders maps to a manifest image", () => {
    const files = ["src/app/page.tsx", "src/config/pdp-content.ts"];
    const urls = new Set(files.flatMap((file) => readFileSync(path.join(ROOT, file), "utf8").match(SHOPIFY) ?? []));
    expect(urls.size).toBeGreaterThan(0);
    for (const url of urls) {
      const id = imageIdForLegacyUrl(url);
      expect(id, url).toBeDefined();
      expect(manifest[id as ImageId], url).toBeDefined();
    }
  });

  it("the manifest holds dimensions and hashes, never bytes, and widths never exceed the original", () => {
    for (const [id, entry] of Object.entries(manifest)) {
      expect(entry.hash, id).toMatch(/^[0-9a-f]{10}$/);
      expect(Math.max(...entry.widths), id).toBeLessThanOrEqual(entry.width);
      expect(JSON.stringify(entry)).not.toMatch(/base64|data:/);
    }
  });

  it("the CSP admits an absolute asset origin, and nothing for /img or unset", () => {
    expect(contentSecurityPolicy(undefined, "https://assets.vokr.shop/img")).toMatch(/img-src [^;]*https:\/\/assets\.vokr\.shop(?!\/)/);
    expect(contentSecurityPolicy(undefined, "/img")).toBe(contentSecurityPolicy(undefined));
    expect(contentSecurityPolicy(undefined, "http://insecure.example")).toBe(contentSecurityPolicy(undefined));
  });
});
