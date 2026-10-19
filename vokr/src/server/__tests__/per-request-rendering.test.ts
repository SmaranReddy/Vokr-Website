import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP = path.resolve(import.meta.dirname, "../../app");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : routeFiles(full);
    return /^(page|layout)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The enforced CSP carries a per-request nonce, so the root layout calls
 * `connection()` and every page renders per request. A route that opts
 * into ISR or build-time params instead renders on demand as static, hits
 * `connection()` and answers 500 (`DYNAMIC_SERVER_USAGE`) — every PDP did,
 * in the deploy smoke test of run 39239227462.
 */
describe("per-request rendering (enforced nonce CSP)", () => {
  it("the root layout opts into per-request rendering", () => {
    expect(readFileSync(path.join(APP, "layout.tsx"), "utf8")).toMatch(/await connection\(\)/);
  });

  it("no page or layout opts into ISR or build-time params", () => {
    const offenders = routeFiles(APP).filter((file) =>
      /export\s+(const\s+revalidate\b|(async\s+)?function\s+generateStaticParams\b|const\s+dynamic\s*=\s*["']force-static["'])/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders.map((file) => path.relative(APP, file))).toEqual([]);
  });
});
