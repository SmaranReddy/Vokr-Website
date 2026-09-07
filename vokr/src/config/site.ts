/**
 * Central site metadata. Values that vary by environment read from
 * NEXT_PUBLIC_SITE_URL (see .env.example) with a local dev fallback.
 */
export const siteConfig = {
  name: "Vokr",
  tagline: "Footwear, rebuilt right.",
  description:
    "Vokr is a footwear D2C brand. This application is the production foundation the storefront is being rebuilt on.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;
