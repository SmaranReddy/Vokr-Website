# Homepage transfer weight (R21), local production build, 19 Oct 2026

Measured with `scripts/assets/measure-homepage.ts`. It loads the page in Chromium,
scrolls to the bottom so lazy images load, and sums the encoded bytes of every
response. The builds are local production builds of `feat/phase-14-18-images-backups`
against the local `vokr_load` database, so this is not a Cloud Run or Cloudflare measurement.

| Mode | Viewport | Total | Images | Scripts | Fonts | Fetch (RSC prefetch) | `cdn.shopify.com` |
|---|---|---|---|---|---|---|---|
| Today (`NEXT_PUBLIC_ASSET_BASE_URL` unset) | desktop 1440×900 | **2,002 KB** | 1,601 KB | 173 KB | 72 KB | 129 KB | 1,601 KB |
| `NEXT_PUBLIC_ASSET_BASE_URL=/img` (served from `public/img`) | desktop 1440×900 | **548 KB** | 144 KB | 173 KB | 72 KB | 130 KB | 0 |
| `NEXT_PUBLIC_ASSET_BASE_URL=/img` | phone 390×844 @2x | **578 KB** | — | — | — | — | 0 |

**Reading:**
- The image pipeline removes about 1.45 MB and every Shopify request. No R2 bucket
  is needed for this, because `/img` is served by the app. R2 remains an option
  (`upload-assets.ts`).
- **R21 (< 500 KB) is still not met:** about 50–80 KB over. What's left is mostly the
  Next.js link prefetch (`Fetch`, ~130 KB) and the 173 KB of JavaScript. Trimming
  the prefetch on header and footer links is the next lever. It is not done here.
- Production today is the first row: Lighthouse measured about 1.9 MB on vokr.shop
  (`results.md` on PR #48).
