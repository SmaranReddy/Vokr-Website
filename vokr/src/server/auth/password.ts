import { createHash } from "node:crypto";

/**
 * No arbitrary composition rules (AGENTS.md / plan §5 Phase 3 Security
 * Requirements) — length is the one meaningful signal. 8 is the commonly
 * cited floor for a password with no other constraint; Supabase's own
 * project-level minimum (dashboard-configured, currently 6 locally per
 * `supabase/config.toml`) is a second, independent gate.
 */
export const MIN_PASSWORD_LENGTH = 8;

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 3000;

/**
 * Checks a password against the Have I Been Pwned breach corpus via its
 * k-anonymity range API — the only breach list reachable at zero cost and
 * with no API key, and the plan calls for a check "if available" (plan §5
 * Phase 3, task 9 / Security Requirements). Only a 5-character SHA-1
 * prefix ever leaves the process; the full password never does.
 *
 * Fails OPEN: a network error, timeout or non-200 response never blocks a
 * legitimate signup because a third-party service is unreachable. The
 * failure is still worth knowing about — once Phase 15's structured
 * logging exists, callers should log it there.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.text();
    return body
      .split("\n")
      .map((line) => line.trim())
      .some((line) => line.split(":")[0] === suffix);
  } catch {
    return false;
  }
}
