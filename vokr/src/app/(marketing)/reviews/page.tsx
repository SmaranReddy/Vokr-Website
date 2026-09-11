import { createMetadata } from "@/lib/metadata";
import { ReviewsSummary } from "@/components/shop/reviews-summary";

export const metadata = createMetadata({
  title: "Reviews",
  alternates: { canonical: "/reviews" },
});

/**
 * `reviews.html` — the same `.rr-section` structure as every PDP, shown
 * in full (`data-full="true"` in the legacy markup), but with its own
 * slightly shorter recommend/summary copy (verified against the legacy
 * source — not a transcription shortcut).
 */
export default function ReviewsPage() {
  return (
    <ReviewsSummary
      full
      recommendText="94% of reviewers would recommend Vokr to a friend."
      summaryText="Customers say Vokr shoes are exceptionally comfortable for all-day wear, with many praising the lightweight design and clean look. Reviewers frequently mention wearing them for long stretches without foot pain. A few note the shoes feel slightly snug at first, and some report durability concerns after several months. Overall, customers appreciate the balance of comfort, style, and versatility."
      photoAlts={["Customer photo", "Customer photo", "Customer photo"]}
    />
  );
}
