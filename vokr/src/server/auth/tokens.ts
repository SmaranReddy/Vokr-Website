import { createHash, randomBytes } from "node:crypto";

/**
 * A fresh 256-bit cryptographically random guest token, hex-encoded (64
 * characters). This is the raw value that lives in the guest's HttpOnly
 * cookie — it is never stored anywhere. See `hashGuestToken()`.
 */
export function generateGuestToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * SHA-256 hash of a raw guest token — the only form persisted in
 * `guest_sessions.token_hash`. A database read (or a backup, or a future
 * read replica) can never be turned into a working session token, because
 * the raw token that would be needed to authenticate never touches the
 * database.
 */
export function hashGuestToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
