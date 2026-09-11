/**
 * Shared address-format constants (plan §5 Phase 6, task 2). No
 * server-only dependencies — imported by both the checkout address form
 * (client) and `src/server/checkout/schemas.ts` (server), so the two
 * never validate against two different patterns.
 */

/** Indian PIN code: 6 digits, first digit 1-8 (postal circles 0 and 9 are not issued). */
export const PINCODE_REGEX = /^[1-8][0-9]{5}$/;

/** E.164: `+` followed by 8-15 digits, no leading zero after the country code. */
export const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;

/**
 * Best-effort normalisation of an Indian mobile number to E.164. Accepts
 * a bare 10-digit number, `0`-prefixed, or already `+91`-prefixed;
 * strips spaces and hyphens. Returns `null` rather than guessing when the
 * input doesn't reduce to a plausible Indian mobile number — the caller
 * (`src/server/checkout/schemas.ts`) turns that into a validation error.
 */
export function normalizeIndianPhoneToE164(input: string): string | null {
  const digitsOnly = input.replace(/[\s-]/g, "");

  if (E164_PHONE_REGEX.test(digitsOnly)) {
    return digitsOnly;
  }

  const withoutCountryCode = digitsOnly.startsWith("+91")
    ? digitsOnly.slice(3)
    : digitsOnly.startsWith("91") && digitsOnly.length === 12
      ? digitsOnly.slice(2)
      : digitsOnly.startsWith("0")
        ? digitsOnly.slice(1)
        : digitsOnly;

  if (/^[6-9][0-9]{9}$/.test(withoutCountryCode)) {
    return `+91${withoutCountryCode}`;
  }

  return null;
}
