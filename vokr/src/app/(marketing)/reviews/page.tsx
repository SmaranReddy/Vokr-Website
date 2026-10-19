import { createMetadata } from "@/lib/metadata";
import { ReviewsSummary } from "@/components/shop/reviews-summary";

export const metadata = createMetadata({
  title: "Reviews",
  alternates: { canonical: "/reviews" },
});

/**
 * `reviews.html` — the same "Ratings and Reviews" section every PDP
 * carries. The legacy page's fabricated reviews, rating and counts were
 * removed under §2A.6 rows R20/L1; see `ReviewsSummary`. The legacy page
 * had no h1; its section heading is the page's main heading here.
 */
export default function ReviewsPage() {
  return <ReviewsSummary headingLevel="h1" />;
}
