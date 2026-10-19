import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ReviewsPage from "@/app/(marketing)/reviews/page";
import { ReviewsSummary } from "@/components/shop/reviews-summary";

/**
 * `/reviews` had no h1 (production audit, 20 Oct 2026): its only heading
 * was the shared section's h2. The page now promotes it; PDPs keep h2
 * beneath the product name.
 */

afterEach(() => cleanup());

describe("ReviewsSummary heading", () => {
  it("is an h2 by default, as on every PDP", () => {
    render(<ReviewsSummary />);
    expect(screen.getByRole("heading", { name: "Ratings and Reviews" }).tagName).toBe("H2");
  });

  it("is the page's one h1 on /reviews, still labelling the section", () => {
    const { container } = render(<ReviewsPage />);
    const heading = screen.getByRole("heading", { level: 1, name: "Ratings and Reviews" });
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Ratings and Reviews" }).contains(heading)).toBe(true);
  });
});
