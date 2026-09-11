import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isPasswordBreached } from "@/server/auth/password";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** The exact suffix `isPasswordBreached` computes for `password`, independent of the module under test. */
function hibpSuffix(password: string): string {
  return createHash("sha1")
    .update(password)
    .digest("hex")
    .toUpperCase()
    .slice(5);
}

describe("isPasswordBreached", () => {
  it("returns true when the suffix appears in the range response", async () => {
    const password = "correct horse battery staple";
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `${hibpSuffix(password)}:3730471\r\nAAAA0000000000000000000000000000000:1\r\n`,
          { status: 200 },
        ),
      );

    await expect(isPasswordBreached(password)).resolves.toBe(true);
  });

  it("returns false when the suffix is absent from the range response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("AAAA0000000000000000000000000000000:1\r\n", {
          status: 200,
        }),
      );

    await expect(
      isPasswordBreached("a-genuinely-unique-passphrase"),
    ).resolves.toBe(false);
  });

  it("only ever sends a 5-character prefix, never the password itself", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    global.fetch = fetchMock;

    await isPasswordBreached("correct horse battery staple");

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(calledUrl).not.toContain("correct horse battery staple");
  });

  it("fails open on a non-200 response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(isPasswordBreached("whatever")).resolves.toBe(false);
  });

  it("fails open on a network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(isPasswordBreached("whatever")).resolves.toBe(false);
  });

  it("fails open on a timeout", async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }),
    );
    await expect(isPasswordBreached("whatever")).resolves.toBe(false);
  });
});
