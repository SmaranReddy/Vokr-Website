/**
 * Every storefront photograph and where its original comes from (plan §5
 * Phase 14, task 2). The app's 18 `cdn.shopify.com` references resolve to
 * these six Shopify files; the legacy HTML's other references belonged to
 * pages and sections that were not migrated or were removed (L1).
 *
 * `legacy` entries are the D7 photographs (§0.3 D7, Phase 14 task 2a):
 * base64 payloads in `index (7).html`, addressed by their `<img>` index in
 * that file. They are extracted read-only — the artefact is never edited
 * (§2A.3). Only the slots whose current alt text already describes the
 * D7 photograph are adopted (hero, explore, outsole); see Phase 14 Status
 * for the Instagram tiles and DOM #2–3.
 */
export interface ImageSource {
  id: string;
  origin: { shopify: string } | { legacyImgIndex: number };
  /** Widths to pre-generate, before capping at the original's width. */
  widths: readonly number[];
}

const LARGE = [480, 800, 1200, 1600] as const;
const CARD = [400, 800, 1200] as const;

const shopify = (file: string) => `https://cdn.shopify.com/s/files/1/0231/2060/9358/files/${file}`;

export const IMAGE_SOURCES: readonly ImageSource[] = [
  { id: "model-x-white-black-side", origin: { shopify: shopify("M000_Black_White_PDP_Side.jpg?v=1778604639") }, widths: LARGE },
  { id: "model-001-black-side", origin: { shopify: shopify("M000_Black_PDP_Side.jpg?v=1778604540") }, widths: LARGE },
  { id: "white-side", origin: { shopify: shopify("M000_White_PDP_Side.jpg?v=1778601772") }, widths: LARGE },
  { id: "antimicrobial-lining", origin: { shopify: shopify("Antimicrobial_lining.jpg?v=1777482622") }, widths: CARD },
  { id: "stretch-laces", origin: { shopify: shopify("LACES2.jpg?v=1777579071") }, widths: CARD },
  // D7 (index (7).html, read-only)
  { id: "model-x-white-overhead", origin: { legacyImgIndex: 0 }, widths: LARGE },
  { id: "model-x-black-overhead", origin: { legacyImgIndex: 1 }, widths: LARGE },
  { id: "outsole-detail", origin: { legacyImgIndex: 8 }, widths: CARD },
];
