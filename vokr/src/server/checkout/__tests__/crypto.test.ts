import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_KEY = randomBytes(32).toString("base64");
const ORIGINAL_KEY = process.env.ADDRESS_ENCRYPTION_KEY;

/**
 * `requireServerEnv()` parses `process.env` once, at `@/lib/env`'s first
 * import (plan-established convention — see `src/lib/env.ts`'s own doc
 * comment). Each test that needs a different key state resets the module
 * registry and re-imports, exactly reproducing a fresh process boot.
 */
async function importCryptoWithEnv(
  overrides: Record<string, string | undefined>,
): Promise<typeof import("../crypto")> {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import("../crypto");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ADDRESS_ENCRYPTION_KEY;
  } else {
    process.env.ADDRESS_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

describe("checkout crypto (plan §5 Phase 6, Security Requirements — address PII encrypted at rest)", () => {
  it("round-trips a plaintext string through encryptField/decryptField", async () => {
    const { encryptField, decryptField } = await importCryptoWithEnv({
      ADDRESS_ENCRYPTION_KEY: VALID_KEY,
    });
    const plaintext = "12 MG Road, Bengaluru";
    const ciphertext = encryptField(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptField(ciphertext)).toBe(plaintext);
  });

  it("produces a different ciphertext (fresh IV) for the same plaintext on repeated calls", async () => {
    const { encryptField } = await importCryptoWithEnv({
      ADDRESS_ENCRYPTION_KEY: VALID_KEY,
    });
    expect(encryptField("Asha Rao")).not.toBe(encryptField("Asha Rao"));
  });

  it("throws when ADDRESS_ENCRYPTION_KEY is not set", async () => {
    const { encryptField } = await importCryptoWithEnv({
      ADDRESS_ENCRYPTION_KEY: undefined,
    });
    expect(() => encryptField("x")).toThrow(/ADDRESS_ENCRYPTION_KEY is not set/);
  });

  it("throws when ADDRESS_ENCRYPTION_KEY does not decode to 32 bytes", async () => {
    const { encryptField } = await importCryptoWithEnv({
      ADDRESS_ENCRYPTION_KEY: Buffer.from("too-short").toString("base64"),
    });
    expect(() => encryptField("x")).toThrow(/32 bytes/);
  });

  it("decryptField rejects a tampered ciphertext (GCM authentication failure)", async () => {
    const { encryptField, decryptField } = await importCryptoWithEnv({
      ADDRESS_ENCRYPTION_KEY: VALID_KEY,
    });
    const token = encryptField("Asha Rao");
    const parts = token.split(":");
    const tampered = [parts[0], parts[1], Buffer.from("tampered!!!!").toString("base64")].join(
      ":",
    );
    expect(() => decryptField(tampered)).toThrow();
  });
});
