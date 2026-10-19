/**
 * Content-Security-Policy (plan §5 Phase 16, task 2) — **enforced**, with a
 * fresh nonce per request (`src/proxy.ts`). It ran report-only first; the
 * switch replaced `'unsafe-inline'` for scripts with the nonce.
 *
 * Scripts: only this site's own, carrying the request's nonce. Next.js
 * stamps it on its framework and page scripts while rendering, which is
 * why every page renders dynamically (`connection()` in the root layout).
 * `'strict-dynamic'` lets a nonced script load others — that is how
 * `loadRazorpayCheckout()` injects Razorpay Checkout — and makes browsers
 * ignore the host list and `'unsafe-inline'`, which stay only as the
 * fallback for CSP Level 2 browsers.
 *
 * Styles keep `'unsafe-inline'` and no nonce: React `style={{…}}`
 * attributes cannot carry one, and a nonce would switch it off.
 *
 * Origins are the ones the browser actually loads from: this site; the
 * legacy product photographs on `cdn.shopify.com`, only while no asset base
 * is configured (see `img-src` below); Razorpay Checkout's script, frames, API and telemetry; and the
 * Supabase project the browser auth client talks to. Google sign-in is a
 * top-level navigation, which CSP does not govern.
 */

const RAZORPAY = [
  "https://checkout.razorpay.com",
  "https://api.razorpay.com",
  "https://cdn.razorpay.com",
  "https://lumberjack.razorpay.com",
];

export const CSP_REPORT_PATH = "/api/csp-report";

export const CSP_HEADER = "Content-Security-Policy";

/** 128 random bits, base64 — unguessable and unique per request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export interface CspOptions {
  nonce: string;
  /** `next dev` needs `'unsafe-eval'` (React rebuilds server error stacks with it). */
  dev?: boolean;
  /** Phase 14: an absolute asset base (the R2 domain) becomes an image origin; `/img` is already 'self'. */
  assetBaseUrl?: string;
}

export function contentSecurityPolicy(supabaseUrl: string | undefined, { nonce, dev = false, assetBaseUrl }: CspOptions): string {
  const supabase = supabaseUrl ? [supabaseUrl.replace(/\/+$/, "")] : [];
  // Phase 14: an absolute asset base (the R2 domain) is an image origin; `/img` is already 'self'.
  const assets = assetBaseUrl && /^https:\/\//.test(assetBaseUrl) ? [new URL(assetBaseUrl).origin] : [];
  // `ResponsiveImage` renders the legacy `cdn.shopify.com` URL only while no
  // asset base is configured (local dev, CI); once one is, every storefront
  // image comes from it (`src/lib/__tests__/images.test.ts` proves each legacy
  // URL maps to a manifest image), so production no longer admits the host.
  // Same "configured" test as `assetBaseUrl()` in `src/lib/images.ts`.
  const legacyImages = assetBaseUrl?.trim().replace(/\/+$/, "") ? [] : ["https://cdn.shopify.com"];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https://checkout.razorpay.com",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...legacyImages, "https://cdn.razorpay.com", ...assets],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabase, ...RAZORPAY],
    "frame-src": ["https://api.razorpay.com", "https://checkout.razorpay.com"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
