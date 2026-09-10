import {
  PDP_REVIEWS,
  PDP_REVIEW_CARD_COUNT,
  REVIEWS_SUMMARY,
  REVIEW_PHOTOS,
  starString,
  type LegacyReview,
} from "@/config/reviews-data";

/**
 * The legacy `.rr-section` ("Ratings and Reviews"), reproduced verbatim.
 * See `config/reviews-data.ts` for why this fabricated content is still
 * here — R20 is pending manager approval (§2A.6), not implemented.
 *
 * `full`: PDP pages show the first 4 cards (`fullPage=false`); the
 * `/reviews` route shows all 10 (`fullPage=true`) — matching the legacy's
 * own `CARD_COUNT_ON_PRODUCT_PAGE` behaviour. `reviews.html`'s own copy
 * for the recommend line and the summary paragraph is a shorter, edited
 * variant of the PDP-shared text (verified against the legacy source,
 * not identical the way the numbers/bars are) — passed in rather than
 * hardcoded so each caller supplies its own page's real wording.
 */
export function ReviewsSummary({
  full = false,
  recommendText = "94% of reviewers would recommend this product to a friend.",
  summaryText = REVIEWS_SUMMARY.summaryText,
}: {
  full?: boolean;
  recommendText?: string;
  summaryText?: string;
}) {
  const cards = full ? PDP_REVIEWS : PDP_REVIEWS.slice(0, PDP_REVIEW_CARD_COUNT);

  return (
    <section id="reviews" className="mx-auto max-w-4xl px-5 py-16">
      <h2 className="mb-2 text-2xl font-bold tracking-tight">
        Ratings and Reviews
      </h2>
      <p className="mb-11 text-center text-[14.5px] text-[#555]">
        {recommendText}
      </p>

      <div className="mb-10 grid grid-cols-1 gap-10 sm:grid-cols-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold">
              {REVIEWS_SUMMARY.averageScore}
            </span>
            <span aria-hidden="true">★★★★☆</span>
          </div>
          <p className="text-xs text-muted-2">
            Based on {REVIEWS_SUMMARY.totalCount} reviews
          </p>
          <div className="mt-4.5 space-y-1.5">
            {REVIEWS_SUMMARY.bars.map((bar) => (
              <div key={bar.stars} className="flex items-center gap-2 text-xs">
                <span className="w-10 shrink-0">{bar.stars} ★</span>
                <div className="h-1.5 flex-1 rounded-full bg-surface">
                  <div
                    className="h-1.5 rounded-full bg-foreground"
                    style={{ width: `${bar.percent}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right">{bar.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-sm font-semibold">Comfort</p>
            <div className="h-1.5 rounded-full bg-surface">
              <div
                className="h-1.5 rounded-full bg-foreground"
                style={{ width: `${REVIEWS_SUMMARY.comfortPercent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>Poor</span>
              <span>Excellent</span>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Fit</p>
            <div className="h-1.5 rounded-full bg-surface">
              <div
                className="h-1.5 rounded-full bg-foreground"
                style={{ width: `${REVIEWS_SUMMARY.fitPercent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>Runs Small</span>
              <span>Runs Large</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 self-start">
          {REVIEW_PHOTOS.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element -- legacy CDN asset, migrated as-is until Phase 14 (R21).
            <img
              key={src}
              src={src}
              alt="Customer photo"
              className="aspect-square rounded-lg bg-surface object-cover"
            />
          ))}
        </div>
      </div>

      <div className="mb-10 rounded-2xl bg-surface-2 p-6">
        <p className="mb-2 text-sm font-semibold">Reviews Summary ✨</p>
        <p className="text-sm leading-relaxed text-foreground/80">
          {summaryText}
        </p>
      </div>

      {/* Legacy `.rr-controls-row` / `.rr-list-meta` — filtering, review
          submission and sorting have no backend yet, so these stay
          present but inert (same treatment as the PDP purchase panel),
          rather than being dropped. */}
      <div className="mb-4 flex gap-3">
        <button
          type="button"
          aria-disabled="true"
          title="Filtering isn't wired to a backend yet"
          className="cursor-default text-sm font-semibold text-muted"
        >
          &#9776; Filters
        </button>
        <button
          type="button"
          aria-disabled="true"
          title="Review submission isn't wired to a backend yet"
          className="cursor-default text-sm font-semibold text-muted"
        >
          &#9998; Write a Review
        </button>
      </div>

      <div className="mb-6 flex items-center justify-between text-sm">
        <span className="font-semibold">
          {REVIEWS_SUMMARY.totalCount} reviews
        </span>
        <label className="text-muted">
          Sort{" "}
          <select
            disabled
            defaultValue="Most Recent"
            className="cursor-default bg-transparent"
          >
            <option>Most Recent</option>
            <option>Highest Rated</option>
            <option>Lowest Rated</option>
            <option>Most Helpful</option>
          </select>
        </label>
      </div>

      <ul className="divide-y divide-border">
        {cards.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>

      {!full && (
        <a
          href="/reviews#reviews"
          className="mt-6 inline-block text-sm font-semibold underline underline-offset-4"
        >
          See all {REVIEWS_SUMMARY.totalCount} reviews &rarr;
        </a>
      )}
    </section>
  );
}

function ReviewCard({ review }: { review: LegacyReview }) {
  return (
    <li className="py-6">
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="text-sm font-bold">
          {review.name}
          {/* Legacy `.rr-card-verified` is #4a9d5f (2.6:1 on white,
              fails WCAG AA) — darkened for contrast per task 12; same
              colour change as the design-token darkening in globals.css. */}
          {review.verified && (
            <span className="ml-2 text-xs font-semibold text-[#1a7f37]">
              ✓ Verified Buyer
            </span>
          )}
        </span>
        <span className="text-xs whitespace-nowrap text-subtle">
          {review.time}
        </span>
      </div>
      <div aria-hidden="true" className="mb-2 tracking-widest">
        {starString(review.rating)}
      </div>
      <p className="mb-1.5 text-sm font-bold">{review.title}</p>
      <p className="max-h-[3.2em] overflow-hidden text-[13.5px] leading-relaxed text-foreground/70">
        {review.body}
      </p>
      {review.photos > 0 && (
        <div className="mt-3 flex gap-1.5">
          {Array.from({ length: review.photos }).map((_, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- legacy CDN asset, migrated as-is until Phase 14 (R21).
            <img
              key={index}
              src={REVIEW_PHOTOS[index % REVIEW_PHOTOS.length]}
              alt={`Customer photo from ${review.name}'s review`}
              className="h-11 w-11 rounded-lg bg-surface object-cover"
            />
          ))}
        </div>
      )}
    </li>
  );
}
