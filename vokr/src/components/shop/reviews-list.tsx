"use client";

import { useMemo, useState } from "react";
import {
  starString,
  REVIEW_PHOTOS,
  type LegacyReview,
} from "@/config/reviews-data";

type SortValue = "Most Recent" | "Highest Rated" | "Lowest Rated" | "Most Helpful";
const SORT_OPTIONS: SortValue[] = [
  "Most Recent",
  "Highest Rated",
  "Lowest Rated",
  "Most Helpful",
];

/**
 * The legacy `.rr-controls-row` (Filters, Sort) and card list, now real:
 * see `reviews.html`'s own script — `rrSortSelect` re-sorts by rating or
 * `helpful`, and `rrFilterBtn` filters to an exact star rating (there via
 * `prompt()`, replaced here with an accessible inline control — same
 * capability, not a `window.prompt()`, which is an implementation
 * choice, not a content change). "Write a Review" stays inert — D5
 * (§0.3), manager-approved 12 Sep 2026.
 *
 * `cards` is the page's own base set (4 on a PDP, 10 on `/reviews`) —
 * filtering/sorting stay inside it rather than reaching into the full
 * catalog the way the legacy's `prompt()` filter did, which is a legacy
 * inconsistency (it bypassed the PDP's own 4-card cap), not a behaviour
 * worth preserving.
 *
 * `totalCount` renders the legacy `.rr-count` "{total} reviews" text
 * verbatim (still fabricated, still unedited pending R20) — passed in
 * rather than recomputed, so filtering the page's own cards down never
 * touches that number. A separate "Showing N of M" hint appears only
 * once a filter is active, so the fabricated total is never silently
 * replaced by a real, smaller, filtered count.
 */
export function ReviewsList({
  cards,
  totalCount,
}: {
  cards: LegacyReview[];
  totalCount: string;
}) {
  const [sort, setSort] = useState<SortValue>("Most Recent");
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visible = useMemo(() => {
    const filtered =
      ratingFilter === null
        ? cards
        : cards.filter((review) => review.rating === ratingFilter);

    const sorted = [...filtered];
    switch (sort) {
      case "Highest Rated":
        sorted.sort((a, b) => b.rating - a.rating);
        break;
      case "Lowest Rated":
        sorted.sort((a, b) => a.rating - b.rating);
        break;
      case "Most Helpful":
        sorted.sort((a, b) => b.helpful - a.helpful);
        break;
      case "Most Recent":
      default:
        // `cards` is already in the legacy's own most-recent-first order.
        break;
    }
    return sorted;
  }, [cards, sort, ratingFilter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="rr-filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
            className="text-sm font-semibold text-muted hover:text-foreground"
          >
            &#9776; Filters{ratingFilter !== null ? ` (${ratingFilter}★)` : ""}
          </button>
          {filtersOpen && (
            <div
              id="rr-filter-panel"
              className="absolute top-full left-0 z-10 mt-2 flex gap-1 rounded-xl border border-border-strong bg-background p-2 shadow-sm"
            >
              {[5, 4, 3, 2, 1].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  aria-pressed={ratingFilter === rating}
                  onClick={() =>
                    setRatingFilter((current) =>
                      current === rating ? null : rating,
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                    ratingFilter === rating
                      ? "border-foreground bg-foreground text-background"
                      : "border-border-strong text-foreground hover:border-foreground"
                  }`}
                >
                  {rating}★
                </button>
              ))}
              <button
                type="button"
                onClick={() => setRatingFilter(null)}
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-disabled="true"
          title="Review submission depends on real orders — D5, deferred to Phase 9 (Vokr-Implementation-Plan.md §0.3)"
          className="cursor-default text-sm font-semibold text-muted"
        >
          &#9998; Write a Review
        </button>
      </div>

      {ratingFilter !== null && (
        <p role="status" className="mb-3 text-xs text-muted">
          Showing {visible.length} of {cards.length}
        </p>
      )}

      <div className="mb-6 flex items-center justify-between text-sm">
        <span className="font-semibold">{totalCount} reviews</span>
        <label className="text-muted">
          Sort{" "}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortValue)}
            className="bg-transparent text-foreground"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-sm text-muted">
          No reviews match that filter.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>
      )}
    </>
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
