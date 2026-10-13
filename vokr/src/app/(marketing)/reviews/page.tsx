import { createMetadata } from "@/lib/metadata";
import { ReviewsSummary } from "@/components/shop/reviews-summary";

export const metadata = createMetadata({
  title: "Reviews",
  alternates: { canonical: "/reviews" },
});

/**
 * `reviews.html` — the same "Ratings and Reviews" section every PDP
 * carries. The legacy page's fabricated reviews, rating and counts were
 * removed under §2A.6 rows R20/L1; see `ReviewsSummary`.
 */
export default function ReviewsPage() {
  return <ReviewsSummary />;
}
