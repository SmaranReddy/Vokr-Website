/**
 * Re-encode every storefront photograph to AVIF + WebP at responsive widths
 * (plan §5 Phase 14, task 3) and write the manifest the app reads.
 *
 *   tsx scripts/assets/build-images.ts --legacy-html "<path to index (7).html>"
 *
 * Originals are fetched (Shopify) or decoded (D7 base64, read-only) into the
 * git-ignored `.asset-work/`; outputs go to `.asset-work/out/` as
 * `<id>-<hash>-<width>.<avif|webp>`, the hash being the first 10 hex digits
 * of the original's SHA-256 — a new photograph is a new URL, so the CDN can
 * cache every file forever. Only `src/config/image-manifest.json` (ids,
 * hashes, dimensions — never bytes) is committed. Re-running with unchanged
 * originals reproduces the same names; nothing is uploaded here
 * (`upload-assets.ts` does that).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { IMAGE_SOURCES, type ImageSource } from "./sources";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORK = path.join(ROOT, ".asset-work");
const OUT = path.join(WORK, "out");
const MANIFEST = path.join(ROOT, "src/config/image-manifest.json");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function legacyImages(file: string): string[] {
  const html = readFileSync(file, "utf8");
  return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => /src="([^"]*)"/.exec(match[0])?.[1] ?? "");
}

async function original(source: ImageSource, legacy: () => string[]): Promise<Buffer> {
  const cache = path.join(WORK, "originals", source.id);
  if (existsSync(cache)) return readFileSync(cache);
  let bytes: Buffer;
  if ("shopify" in source.origin) {
    const response = await fetch(source.origin.shopify);
    if (!response.ok) throw new Error(`${source.id}: ${response.status} from Shopify`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    const src = legacy()[source.origin.legacyImgIndex] ?? "";
    const data = /^data:image\/[a-z]+;base64,(.+)$/s.exec(src);
    if (!data) throw new Error(`${source.id}: <img> #${source.origin.legacyImgIndex} is not a base64 image`);
    bytes = Buffer.from(data[1]!, "base64");
  }
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, bytes);
  return bytes;
}

export interface ManifestEntry {
  hash: string;
  width: number;
  height: number;
  widths: number[];
  originalBytes: number;
  bytes: Record<string, { avif: number; webp: number }>;
}

async function main(): Promise<void> {
  const legacyHtml = arg("legacy-html");
  let legacyCache: string[] | null = null;
  const legacy = () => {
    if (!legacyHtml) throw new Error("--legacy-html <path to index (7).html> is required for the D7 photographs.");
    return (legacyCache ??= legacyImages(legacyHtml));
  };
  mkdirSync(OUT, { recursive: true });
  const manifest: Record<string, ManifestEntry> = {};

  for (const source of IMAGE_SOURCES) {
    const bytes = await original(source, legacy);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
    const meta = await sharp(bytes).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const widths = [...new Set(source.widths.map((w) => Math.min(w, width)))].sort((a, b) => a - b);
    const entry: ManifestEntry = { hash, width, height, widths, originalBytes: bytes.length, bytes: {} };
    for (const w of widths) {
      const base = path.join(OUT, `${source.id}-${hash}-${w}`);
      const resized = sharp(bytes).rotate().resize({ width: w, withoutEnlargement: true });
      const avif = await resized.clone().avif({ quality: 50, effort: 6 }).toBuffer();
      const webp = await resized.clone().webp({ quality: 72, effort: 6 }).toBuffer();
      writeFileSync(`${base}.avif`, avif);
      writeFileSync(`${base}.webp`, webp);
      entry.bytes[String(w)] = { avif: avif.length, webp: webp.length };
    }
    manifest[source.id] = entry;
    console.log(`${source.id}: ${width}x${height} ${Math.round(bytes.length / 1024)} KB → ${widths.join("/")} (avif@${widths.at(-1)} ${Math.round(entry.bytes[String(widths.at(-1))]!.avif / 1024)} KB)`);
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: ${Object.keys(manifest).length} images → src/config/image-manifest.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
