/**
 * Publish the encoded photographs (plan §5 Phase 14, task 4).
 *
 *   tsx scripts/assets/upload-assets.ts --to r2 [--apply]     # R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ASSETS_BUCKET
 *   tsx scripts/assets/upload-assets.ts --to public [--apply] # copy into public/img (self-hosted)
 *
 * Reads `src/config/image-manifest.json` and `.asset-work/out/` (from
 * `build-images.ts`). Every file named in the manifest must exist locally.
 * Safe to re-run: names are content-hashed, so an object that already
 * exists is skipped, never overwritten. Uploads carry
 * `Cache-Control: public, max-age=31536000, immutable`. Dry run by default.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import manifest from "../../src/config/image-manifest.json";
import { imageFileName } from "../../src/lib/images";
import { objectExists, putObject, r2Client, readR2Config } from "../lib/r2";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, ".asset-work", "out");
const PUBLIC_DIR = path.join(ROOT, "public", "img");
const CACHE = "public, max-age=31536000, immutable";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const to = arg("to");
  if (to !== "r2" && to !== "public") throw new Error("--to r2 | public is required.");
  const apply = process.argv.includes("--apply");
  const files = Object.entries(manifest).flatMap(([id, entry]) =>
    entry.widths.flatMap((w) => (["avif", "webp"] as const).map((format) => ({ name: imageFileName(id, entry.hash, w, format), format }))),
  );
  const missing = files.filter((file) => !existsSync(path.join(OUT, file.name)));
  if (missing.length > 0) throw new Error(`${missing.length} file(s) missing from .asset-work/out — run build-images.ts first (e.g. ${missing[0]!.name}).`);

  let written = 0;
  let skipped = 0;
  if (to === "public") {
    if (apply) mkdirSync(PUBLIC_DIR, { recursive: true });
    for (const file of files) {
      if (existsSync(path.join(PUBLIC_DIR, file.name))) skipped += 1;
      else if (apply) {
        copyFileSync(path.join(OUT, file.name), path.join(PUBLIC_DIR, file.name));
        written += 1;
      } else written += 1;
    }
  } else {
    const config = apply ? readR2Config(process.env, "R2_ASSETS_BUCKET") : null;
    const client = config ? r2Client(config) : null;
    for (const file of files) {
      if (!client || !config) {
        written += 1;
        continue;
      }
      if (await objectExists(client, config.bucket, file.name)) {
        skipped += 1;
        continue;
      }
      await putObject(client, config.bucket, file.name, readFileSync(path.join(OUT, file.name)), {
        contentType: file.format === "avif" ? "image/avif" : "image/webp",
        cacheControl: CACHE,
      });
      written += 1;
    }
  }
  console.log(`${apply ? "" : "[dry-run] "}${to}: ${written} ${apply ? "written" : "to write"}, ${skipped} already present, ${files.length} in manifest`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
