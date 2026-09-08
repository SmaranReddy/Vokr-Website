import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Egress discipline regression (Phase 2, task 11). Supabase egress is the
 * sharpest free-tier cliff in the stack (Vokr-Implementation-Plan.md
 * §3.3) — every Prisma call site in `src/server/` must name its columns
 * explicitly. This scans source rather than relying on review alone, and
 * it must never be deleted (§7.3).
 *
 * Two things are disallowed on any `prisma.<model>.<method>(...)` call
 * that can return row data:
 *   1. No `select:` key anywhere in the call — equivalent to `SELECT *`.
 *   2. `include:` — pulls every scalar column of the related row, which
 *      is the same defect one join level deeper.
 */

const SERVER_ROOT = join(import.meta.dirname, "..", "..");

const METHODS_REQUIRING_SELECT = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "create",
  "update",
  "upsert",
  "updateMany",
] as const;

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "db") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extracts the balanced-paren argument text following `prisma.x.method(`
 * starting at `openParenIndex` (the index of the `(`).
 */
function extractCallArguments(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i++) {
    const char = source[i];
    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(openParenIndex + 1, i);
      }
    }
  }
  throw new Error("Unbalanced parentheses while scanning a prisma call.");
}

describe("egress discipline: no Prisma call site omits select", () => {
  const files = listSourceFiles(SERVER_ROOT);
  // Guard against the scan itself silently finding nothing to check.
  it("scanned at least one source file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  const callPattern = new RegExp(
    `prisma\\.\\w+\\.(${METHODS_REQUIRING_SELECT.join("|")})\\s*\\(`,
    "g",
  );

  for (const file of files) {
    const relative = file.slice(SERVER_ROOT.length + 1);
    it(`${relative} — every prisma call selects explicit fields`, () => {
      const source = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      callPattern.lastIndex = 0;

      // No `prisma.*` call sites is a pass by construction — the loop
      // below simply never runs. The point of this test is that the
      // moment such a call site is *added*, this file's own scan (which
      // includes itself, per `listSourceFiles`) starts checking it —
      // nothing extra to wire up.
      while ((match = callPattern.exec(source))) {
        const openParenIndex = match.index + match[0].length - 1;
        const args = extractCallArguments(source, openParenIndex);

        expect(
          /include\s*:/.test(args),
          `${relative}: call to prisma.*.${match[1]}(...) uses "include:", which fetches every column of the related row.`,
        ).toBe(false);

        expect(
          /select\s*:/.test(args),
          `${relative}: call to prisma.*.${match[1]}(...) has no "select:" — equivalent to SELECT *.`,
        ).toBe(true);
      }
    });
  }
});
