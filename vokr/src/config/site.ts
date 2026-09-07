import { clientEnv } from "@/lib/env";

/**
 * Central site metadata. Values that vary by environment read from
 * NEXT_PUBLIC_SITE_URL (see .env.example) with a local dev fallback.
 */
export const siteConfig = {
  name: "Vokr",
  tagline: "Footwear, rebuilt right.",
  description:
    "Vokr is a footwear D2C brand. This application is the production foundation the storefront is being rebuilt on.",
  // PHASE 19 GATE (Vokr-Implementation-Plan.md §2.5): NEXT_PUBLIC_* values
  // are inlined at *build* time. If the CI build ever runs without
  // NEXT_PUBLIC_SITE_URL set, this falls back to localhost with no runtime
  // error — metadataBase, canonical URLs and Open Graph images would all
  // silently point at localhost in production. Phase 19 must assert the
  // variable is set before the production build runs.
  url: clientEnv.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
