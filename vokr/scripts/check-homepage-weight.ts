/**
 * Phase 14 task 9 (R21) — the homepage weight budget.
 *
 * R21 defines the homepage's total *first-load* transfer weight, under
 * 500 KB (Vokr-Implementation-Plan.md: "Homepage weight budget (R21):
 * under 500 KB total transfer. Enforced by an automated check in CI that
 * fails the build if exceeded."). The check this replaces summed every
 * `.js` file directly under `.next/static/chunks` — every route's
 * compiled output mashed into one flat directory, not one page's — which
 * is why a clean build measured well over a megabyte before a single
 * homepage-specific dependency existed: two framework-owned files alone
 * (the shared React/Next.js runtime chunks every route loads, and Next's
 * own static `polyfill-nomodule.js`, byte-identical across any Next.js
 * 16.3.4 build regardless of app code) already exceed the budget with
 * zero app code counted. See Vokr-Implementation-Plan.md's 12 Sep 2026
 * R21 notes for the full investigation.
 *
 * This reads Next.js's own `.next/diagnostics/route-bundle-stats.json`
 * — written automatically by `next build` (see
 * `node_modules/next/dist/build/route-bundle-stats.js`), no extra build
 * flag required — which Next.js computes per route from its own build
 * manifests: for the `/` route, exactly the JS chunks a browser requests
 * on first load, and nothing from any other route. That is the R21
 * "homepage first-load transfer" quantity directly, not an approximation
 * of it.
 *
 * `route-bundle-stats.json` is an internal Next.js build diagnostic, not
 * a documented public API, so every failure mode below is explicit
 * rather than silently passing — if a future Next.js version removes or
 * reshapes this file, this script fails loudly instead of quietly
 * reporting 0 bytes and going green on a homepage that regressed.
 *
 * Threshold and logic are otherwise unchanged from the check this
 * replaces: still exactly 512,000 bytes (500 KB), still JS-chunk bytes
 * measured on disk after a production build, still fails the build.
 *
 *   npm run check:homepage-weight
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const BUDGET_BYTES = 512_000;
const HOMEPAGE_ROUTE = "/";

const projectRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(projectRoot, ".next");
const statsFile = path.join(distDir, "diagnostics", "route-bundle-stats.json");

interface RouteBundleStat {
  route: string;
  firstLoadUncompressedJsBytes?: number;
  firstLoadChunkPaths?: string[];
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** Resolves a manifest path (either `/`- or `\`-separated — Next.js writes the host OS's separator) to an absolute path under the project root. */
function resolveProjectPath(relPath: string): string {
  const segments = relPath.split(/[\\/]/).filter(Boolean);
  return path.join(projectRoot, ...segments);
}

function main(): void {
  let raw: string;
  try {
    raw = readFileSync(statsFile, "utf8");
  } catch (error) {
    fail(
      `could not read ${statsFile} — run \`next build\` first. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }

  let stats: unknown;
  try {
    stats = JSON.parse(raw);
  } catch {
    fail(
      `${statsFile} is not valid JSON — Next.js's diagnostics format may have changed.`,
    );
  }

  if (!Array.isArray(stats)) {
    fail(
      `${statsFile} did not contain an array of route stats — Next.js's diagnostics format may have changed.`,
    );
  }

  const home = (stats as RouteBundleStat[]).find(
    (r) => r && r.route === HOMEPAGE_ROUTE,
  );
  if (!home) {
    fail(
      `no "${HOMEPAGE_ROUTE}" entry in ${statsFile} — the homepage route is missing from Next.js's own build stats.`,
    );
  }

  const chunkPaths = home.firstLoadChunkPaths;
  if (!Array.isArray(chunkPaths) || chunkPaths.length === 0) {
    fail(
      `the "${HOMEPAGE_ROUTE}" entry in ${statsFile} has no firstLoadChunkPaths.`,
    );
  }

  let size = 0;
  for (const relPath of chunkPaths) {
    if (typeof relPath !== "string" || !relPath.endsWith(".js")) {
      fail(
        `"${String(relPath)}" in the homepage's first-load chunks is not a .js file path — refusing to guess what it is.`,
      );
    }
    const absPath = resolveProjectPath(relPath);
    let fileSize: number;
    try {
      fileSize = statSync(absPath).size;
    } catch {
      fail(
        `homepage first-load chunk "${relPath}" (resolved to ${absPath}) does not exist on disk.`,
      );
    }
    size += fileSize;
  }

  console.log(`Homepage first-load JS weight: ${size} bytes`);

  if (size > BUDGET_BYTES) {
    fail(
      `homepage first-load JS (${size} bytes) exceeds the ${BUDGET_BYTES}-byte (500 KB) budget.`,
    );
  }

  console.log(`OK: under the ${BUDGET_BYTES}-byte (500 KB) budget.`);
}

main();
