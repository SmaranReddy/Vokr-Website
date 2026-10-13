import { clientEnv } from "@/lib/env";

/**
 * Central site metadata. Values that vary by environment read from
 * NEXT_PUBLIC_SITE_URL (see .env.example) with a local dev fallback.
 */
export const siteConfig = {
  name: "Vokr",
  tagline: "Footwear, rebuilt right.",
  // The default meta description for every page without its own. Customer
  // facing and factual: what Vokr makes and what the catalogue holds — no
  // ratings, customer counts or availability promises (§2A.6 row L1).
  description:
    "Vokr designs one versatile everyday shoe, sized in Indian/UK sizing. Browse Model x, Model 001, Kids Model abc, socks and stretch laces.",
  // PHASE 19 GATE (Vokr-Implementation-Plan.md §2.5): NEXT_PUBLIC_* values
  // are inlined at *build* time. If the CI build ever runs without
  // NEXT_PUBLIC_SITE_URL set, this falls back to localhost with no runtime
  // error — metadataBase, canonical URLs and Open Graph images would all
  // silently point at localhost in production. Phase 19 must assert the
  // variable is set before the production build runs.
  url: clientEnv.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
} as const;
