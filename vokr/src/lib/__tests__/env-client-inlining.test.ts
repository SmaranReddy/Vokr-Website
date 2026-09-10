import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLIENT_KEYS } from "@/lib/env-client";

/**
 * Guards the one property of `env-client.ts` that no runtime test can
 * observe: Next.js only inlines a `NEXT_PUBLIC_*` value into the browser
 * bundle where the source contains a *static* `process.env.NAME` member
 * expression. Passing `process.env` as an object (or building the source
 * with a loop, spread, or computed key) compiles to a lookup against the
 * browser's empty `process` shim — every variable reads `undefined` on
 * the client, `createSupabaseBrowserClient()` throws, and the server half
 * keeps working so nothing fails until a user loads the page.
 *
 * Under Vitest `process.env` is fully populated, so asserting on
 * `clientEnv` values would pass in both the correct and the broken form.
 * The source text is therefore the only place the distinction is visible,
 * which is why this test reads the file.
 */
const RAW = readFileSync(
  path.resolve(import.meta.dirname, "../env-client.ts"),
  "utf8",
);

/**
 * Comments are stripped before matching: the file documents the broken
 * form verbatim so the next reader knows what not to write, and a naive
 * search would find that prose and fail on correct code.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

describe("client env inlining", () => {
  it.each(CLIENT_KEYS)(
    "%s is read as a static process.env member expression",
    (key) => {
      expect(SOURCE).toContain(`process.env.${key}`);
    },
  );

  it("never passes process.env wholesale to parseEnvSection", () => {
    expect(SOURCE).not.toMatch(
      /parseEnvSection\(\s*clientSchema\s*,\s*process\.env\s*,/,
    );
  });

  it("declares a source entry for every key in the schema", () => {
    const declared = [
      ...SOURCE.matchAll(/(NEXT_PUBLIC_\w+): process\.env\./g),
    ].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(CLIENT_KEYS));
  });
});
