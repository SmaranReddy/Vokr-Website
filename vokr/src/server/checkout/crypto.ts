import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requireServerEnv } from "@/lib/env";

/**
 * Application-layer AES-256-GCM for address PII at rest (`Address.nameEnc`
 * / `line1Enc` / `line2Enc` / `phoneEnc` — plan §5 Phase 6, Security
 * Requirements: "Address PII encrypted at rest"). Not pgcrypto — same
 * convention `AppUser.phoneEnc`'s doc comment already commits to
 * (AGENTS.md "Security & privacy").
 *
 * Encoded as `<iv_b64>:<authTag_b64>:<ciphertext_b64>`. A fresh random IV
 * per call (GCM requires IV uniqueness per key, never reuse) — never
 * derived from the plaintext or any row id.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = requireServerEnv().ADDRESS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ADDRESS_ENCRYPTION_KEY is not set. Address PII cannot be encrypted " +
        "or decrypted without it — see .env.example.",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `ADDRESS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes ` +
        `(got ${key.length}). Generate one with "openssl rand -base64 32".`,
    );
  }

  cachedKey = key;
  return key;
}

/** Test-only: forces the next call to re-read `ADDRESS_ENCRYPTION_KEY`. */
export function __resetCryptoKeyCacheForTests(): void {
  cachedKey = null;
}

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptField(token: string): string {
  const key = getKey();
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error("decryptField: malformed ciphertext envelope.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
