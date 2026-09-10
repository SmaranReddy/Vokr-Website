/**
 * The "Ratings and Reviews" content shared by every legacy PDP
 * (`vokr-production/shop-*.html`, `var REVIEWS = [...]`) and by
 * `reviews.html`. Verified byte-identical across all five PDPs (§2A.7
 * check, 10 Sep 2026).
 *
 * This is exactly what Vokr-Implementation-Plan.md **R20** (§2A.6, Phase
 * 4 task 8) proposes to delete — 10 reviews, 8 marked `verified: true`,
 * a "4.7" average and a "4,059 reviews" count with no real orders behind
 * them. R20 is **PENDING APPROVAL** and is not implemented here: per
 * §2A.4 nothing approved-content may be removed unilaterally, so this
 * data is transcribed verbatim rather than corrected. Do not edit these
 * values without an approved §2A.6 row — see AGENTS.md's "never publish
 * fabricated reviews" rule, which is why this is flagged rather than
 * silently carried forward.
 */

export interface LegacyReview {
  id: number;
  name: string;
  initial: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  time: string;
  verified: boolean;
  fit: string;
  size: string;
  photos: number;
  helpful: number;
}

export const PDP_REVIEWS: LegacyReview[] = [
  { id: 1, name: "Leon", initial: "L", rating: 5, title: "Best everyday shoe I've owned", body: "Wore these through back-to-back client meetings and a flight to Delhi. Still felt like I'd just put them on. The copper lining actually works — no odor even after a full day.", time: "3 hours ago", verified: true, fit: "True to size", size: "IN 9", photos: 3, helpful: 24 },
  { id: 2, name: "Priyanka M.", initial: "P", rating: 5, title: "Packed one pair for a 3-week trip", body: "Three weeks in Mumbai and I only packed one pair of shoes. That was a first for me. Comfortable enough for walking all day, smart enough for client dinners.", time: "1 day ago", verified: true, fit: "True to size", size: "IN 6", photos: 2, helpful: 41 },
  { id: 3, name: "Arjun N.", initial: "A", rating: 5, title: "Compliments every time I wear them", body: "My architect friends kept asking where I got them. Told all of them. Clean design, very comfortable, holds up well.", time: "2 days ago", verified: true, fit: "True to size", size: "IN 8", photos: 1, helpful: 18 },
  { id: 4, name: "Sneha K.", initial: "S", rating: 4, title: "Great daily driver, runs slightly snug", body: "From Koramangala to Connaught Place — one shoe, zero complaints. Only note: fit is a touch snug out of the box, loosens up after a week of wear.", time: "4 days ago", verified: true, fit: "Runs small", size: "IN 5", photos: 0, helpful: 12 },
  { id: 5, name: "Karan K.", initial: "K", rating: 5, title: "Understood what other shoe brands haven't", body: "I design experiences for a living, so I notice when a product is actually thought through. Vokr gets the small details right — the laces, the lining, the sole flex.", time: "6 days ago", verified: true, fit: "True to size", size: "IN 9", photos: 2, helpful: 33 },
  { id: 6, name: "Aditya R.", initial: "A", rating: 5, title: "Six months in, still my go-to", body: "Office, gym, travel, every day. These are the only shoes I reach for now. Held up better than I expected given how often I wear them.", time: "1 week ago", verified: true, fit: "True to size", size: "IN 10", photos: 0, helpful: 29 },
  { id: 7, name: "Ritika S.", initial: "R", rating: 3, title: "Comfortable but durability could be better", body: "Comfort is genuinely excellent, no complaints there. But the sole on my pair started showing wear after about four months of regular use. Hoping this improves.", time: "2 weeks ago", verified: true, fit: "True to size", size: "IN 6", photos: 1, helpful: 15 },
  { id: 8, name: "Vikram T.", initial: "V", rating: 5, title: "Worth the price", body: "Was skeptical about the price at first but honestly worth it. Wear them almost daily and they still look and feel new.", time: "3 weeks ago", verified: false, fit: "True to size", size: "IN 9", photos: 0, helpful: 7 },
  { id: 9, name: "Neha J.", initial: "N", rating: 2, title: "Didn't work for my foot shape", body: "Shoes are well made but just didn't suit my foot shape — felt tight across the top even after sizing up. Return process was smooth at least.", time: "1 month ago", verified: true, fit: "Runs small", size: "IN 7", photos: 0, helpful: 9 },
  { id: 10, name: "Farhan A.", initial: "F", rating: 5, title: "My whole team wears these now", body: "Recommended these to three coworkers after wearing mine for two months straight. Genuinely comfortable for long office days.", time: "1 month ago", verified: true, fit: "True to size", size: "IN 10", photos: 3, helpful: 21 },
];

/** `reviews.html`'s photo strip / review-card thumbnails — the same three shared placeholder images used on every PDP. */
export const REVIEW_PHOTOS = [
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
  "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772",
] as const;

export const REVIEWS_SUMMARY = {
  recommendPercent: 94,
  averageScore: "4.7",
  totalCount: "4,059",
  bars: [
    { stars: 5, percent: 84, count: "3.4k" },
    { stars: 4, percent: 8, count: "344" },
    { stars: 3, percent: 4, count: "155" },
    { stars: 2, percent: 2, count: "84" },
    { stars: 1, percent: 2, count: "96" },
  ],
  comfortPercent: 92,
  fitPercent: 88,
  summaryText:
    "Customers say these shoes are exceptionally comfortable for all-day wear, with many praising their lightweight design and clean aesthetic. Users frequently mention wearing them for extended periods — from work shifts to travel — without foot pain or discomfort. The color options and breathable knit are popular features. Several customers note they're repeat buyers, owning multiple pairs. A few mention the shoes feel slightly stiff initially or snug compared to competitors, and some report durability concerns with recent purchases. Overall, customers appreciate the balance of comfort, style, and versatility for everyday activities.",
} as const;

/** Legacy `CARD_COUNT_ON_PRODUCT_PAGE` — the PDP shows the first 4; `/reviews` shows all 10. */
export const PDP_REVIEW_CARD_COUNT = 4;

export function starString(rating: number): string {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}
