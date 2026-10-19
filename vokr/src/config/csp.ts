/**
 * Content-Security-Policy (plan §5 Phase 16, task 2), deployed
 * **report-only** first: browsers send what the policy would have blocked
 * to `/api/csp-report`, nothing is blocked. Once a period of real traffic
 * (including real Razorpay Checkout sessions) reports nothing unexpected,
 * it is switched to enforcing, with nonces replacing `'unsafe-inline'` for
 * scripts.
 *
 * Origins are the ones the browser actually loads from: this site; the
 * legacy product photographs on `cdn.shopify.com` (until Phase 14 re-hosts
 * them); Razorpay Checkout's script, frames, API and telemetry; and the
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

export function contentSecurityPolicy(supabaseUrl: string | undefined, assetBaseUrl?: string): string {
  const supabase = supabaseUrl ? [supabaseUrl.replace(/\/+$/, "")] : [];
  // Phase 14: an absolute asset base (the R2 domain) is an image origin; `/img` is already 'self'.
  const assets = assetBaseUrl && /^https:\/\//.test(assetBaseUrl) ? [new URL(assetBaseUrl).origin] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js inlines its bootstrap scripts; nonces replace this when enforcing.
    "script-src": ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://cdn.shopify.com", "https://cdn.razorpay.com", ...assets],
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
