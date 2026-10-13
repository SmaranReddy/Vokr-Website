/**
 * Maps the `?error=` codes the auth route handlers redirect with onto
 * customer-facing copy.
 *
 * `/api/auth/confirm` and `/api/auth/callback` both bounce failures to
 * `/sign-in?error=…` and record the real reason in the server log only —
 * but until 9 Sep 2026 nothing read the parameter, so a failed email
 * confirmation or OAuth sign-in showed a bare sign-in page and was
 * indistinguishable from a successful one. See Vokr-Implementation-Plan.md,
 * Phase 3 defect log.
 *
 * An unrecognised code maps to `null` rather than being echoed: the value
 * arrives from the URL, and rendering attacker-supplied text on the
 * sign-in page is how a phishing message gets onto a trusted origin.
 * Copy stays deliberately vague about *why* — telling a visitor whether a
 * link was expired, already used or never valid narrows an attacker's
 * guesses about an account they do not own.
 */
const SIGN_IN_ERROR_MESSAGES = new Map<string, string>([
  [
    "confirm",
    "We couldn't confirm your email from that link. It may have already been used or expired — sign in below, or sign up again to get a new link.",
  ],
  ["oauth", "We couldn't complete that sign-in. Please try again."],
]);

export function signInErrorMessage(
  raw: string | string[] | undefined,
): string | null {
  // Next.js gives an array when a parameter is repeated; take the first.
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (typeof code !== "string") {
    return null;
  }
  // A Map, not an object literal: a plain-object lookup would resolve
  // `constructor`, `toString` or `__proto__` to something inherited from
  // Object.prototype and render it.
  return SIGN_IN_ERROR_MESSAGES.get(code) ?? null;
}
