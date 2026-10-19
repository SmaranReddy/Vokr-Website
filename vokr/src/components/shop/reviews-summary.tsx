/**
 * The "Ratings and Reviews" section shared by every PDP and `/reviews`.
 *
 * The legacy `.rr-section` shipped 10 fabricated reviews (8 marked
 * "Verified Buyer"), a "4.7" average, a "4,059 reviews" count, a star
 * breakdown, a "94% would recommend" line, an AI-style "Reviews Summary"
 * and "customer photos" — none backed by a real order. They were deleted
 * under §2A.6 rows R20/L1 (AGENTS.md: "Never publish fabricated reviews,
 * ratings or review counts"). The legacy heading is kept; the body is an
 * honest empty state. There is deliberately no rating, count or
 * structured data here until real, order-verified reviews exist (Phase 9).
 *
 * `headingLevel` is `h1` on `/reviews`, where this section is the whole
 * page and its heading the page's main heading; PDPs keep `h2` under the
 * product name.
 */
export function ReviewsSummary({ headingLevel = "h2" }: { headingLevel?: "h1" | "h2" }) {
  const Heading = headingLevel;
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="mx-auto max-w-4xl px-5 py-16"
    >
      <Heading id="reviews-heading" className="mb-4 text-2xl font-bold tracking-tight">
        Ratings and Reviews
      </Heading>
      <div className="rounded-2xl border border-border-strong p-6 text-center">
        <p className="text-sm font-semibold">No reviews yet.</p>
        <p className="mt-2 text-sm text-muted">
          Customer reviews will appear here only once they come from verified
          purchases.
        </p>
      </div>
    </section>
  );
}
