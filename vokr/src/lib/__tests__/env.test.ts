import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertNoServerKeyLeak, parseEnvSection } from "@/lib/env";

describe("parseEnvSection — missing variable", () => {
  it("throws a single aggregated error listing every missing required variable", () => {
    const schema = z.object({ FOO: z.string(), BAR: z.string() });

    let thrown: unknown;
    try {
      parseEnvSection(schema, {}, "Test environment");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Both missing keys are reported by one throw, not one at a time.
    expect(message).toContain("FOO");
    expect(message).toContain("BAR");
  });
});

describe("parseEnvSection — wrong type", () => {
  it("throws when a variable does not satisfy its schema shape", () => {
    const schema = z.object({ SITE_URL: z.url() });
    expect(() =>
      parseEnvSection(schema, { SITE_URL: "not-a-url" }, "Test environment"),
    ).toThrowError(/SITE_URL/);
  });
});

describe("parseEnvSection — success", () => {
  it("returns the parsed, typed value when every variable is valid", () => {
    const schema = z.object({ NAME: z.string() });
    const result = parseEnvSection(
      schema,
      { NAME: "vokr" },
      "Test environment",
    );
    expect(result).toEqual({ NAME: "vokr" });
  });
});

describe("assertNoServerKeyLeak — NEXT_PUBLIC_ leak", () => {
  it("throws when a server-only variable is also declared as a NEXT_PUBLIC_ client variable", () => {
    expect(() =>
      assertNoServerKeyLeak(["SECRET_KEY"], ["NEXT_PUBLIC_SECRET_KEY"]),
    ).toThrowError(/SECRET_KEY/);
  });

  it("does not throw when no server key leaks into the client namespace", () => {
    expect(() =>
      assertNoServerKeyLeak(["SECRET_KEY"], ["NEXT_PUBLIC_SITE_URL"]),
    ).not.toThrow();
  });
});
