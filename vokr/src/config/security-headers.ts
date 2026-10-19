/**
 * Response security headers for every route (plan §5 Phase 16, task 1),
 * applied from `next.config.ts`.
 *
 * - HSTS: one year, deliberately **without** `includeSubDomains` or
 *   `preload` — owner decision, 16 Oct 2026: those commit every
 *   `vokr.shop` subdomain to HTTPS (and preload is hard to undo).
 * - `X-Frame-Options: DENY`: no page may be framed (clickjacking). The CSP
 *   `frame-ancestors` equivalent follows with the CSP rollout.
 * - `Cross-Origin-Opener-Policy: same-origin-allow-popups`: isolates the
 *   browsing context but keeps popups Razorpay Checkout opens for UPI and
 *   netbanking working.
 * - `Permissions-Policy`: no camera, microphone, geolocation, USB or
 *   sensors; Payment Request only for this site and Razorpay Checkout.
 *
 * Content-Security-Policy is report-only for now (`csp.ts`): violations go
 * to `/api/csp-report`, nothing is blocked.
 */
import { contentSecurityPolicy } from "./csp";

export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicy(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_ASSET_BASE_URL),
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), payment=(self "https://checkout.razorpay.com"), interest-cohort=()',
  },
];
