import { test, expect } from "@playwright/test";
import {
  extractLegacyPage,
  extractStructure,
  assertSupersetAroundCardList,
} from "./fidelity/extract";

/**
 * §2A.7 fidelity regression — text-content diff (item 1) and structural
 * heading diff (item 2) between each migrated route and its legacy
 * source. "The diff must be empty, or every line in it must trace to an
 * approved row in §2A.6."
 *
 * Covers the homepage, both legal pages, all five standalone support
 * pages and one marketing page as a representative sample verified in
 * Phase 4; the same `extractLegacyPage`/`extractStructure` pair in
 * `./fidelity/extract.ts` extends to the remaining marketing pages with
 * one line per route.
 */

interface FidelityCase {
  route: string;
  legacyFile: string;
  /**
   * `reviews.html` populates its review-card list via a client-side
   * `innerHTML =` call the legacy page's own `<script>` makes at
   * runtime — that script sits outside the nav→footer slice
   * `extractLegacyPage` reads (by design: scripts aren't page content)
   * and is never executed, so the *static* legacy source genuinely
   * contains none of that card text. The migrated route renders the
   * same cards server-side instead, from `config/reviews-data.ts`
   * (transcribed from that same script — see that file's doc comment).
   * A superset check here still catches any *dropped or altered*
   * static copy (the recommend line, the summary paragraph, the score
   * bars); it just doesn't fault the migrated page for statically
   * rendering content the legacy only ever produced by executing JS.
   */
  supersetOk?: boolean;
}

const CASES: FidelityCase[] = [
  { route: "/", legacyFile: "index.html" },
  { route: "/terms", legacyFile: "terms.html" },
  { route: "/privacy-policy", legacyFile: "privacy-policy.html" },
  { route: "/support-order-status", legacyFile: "support-order-status.html" },
  {
    route: "/support-exchange-returns",
    legacyFile: "support-exchange-returns.html",
  },
  { route: "/support-faq", legacyFile: "support-faq.html" },
  { route: "/support-help", legacyFile: "support-help.html" },
  { route: "/support-contact", legacyFile: "support-contact.html" },
  { route: "/about-vokr", legacyFile: "about-vokr.html" },
  { route: "/why-vokr", legacyFile: "why-vokr.html" },
  { route: "/technology", legacyFile: "technology.html" },
  { route: "/community", legacyFile: "community.html" },
  { route: "/blog", legacyFile: "blog.html" },
  { route: "/jobs", legacyFile: "jobs.html" },
  { route: "/vokr-ambassadors", legacyFile: "vokr-ambassadors.html" },
  { route: "/wholesale-orders", legacyFile: "wholesale-orders.html" },
  { route: "/discount-program", legacyFile: "discount-program.html" },
  { route: "/refer-a-friend", legacyFile: "refer-a-friend.html" },
  { route: "/subscription", legacyFile: "subscription.html" },
  { route: "/analyze-your-shoes", legacyFile: "analyze-your-shoes.html" },
  { route: "/reviews", legacyFile: "reviews.html", supersetOk: true },
  // The 5 dynamic PDP routes (task 5) — name/price/sizes come from the
  // live Phase 2 catalog rather than static markup (the seeded catalog,
  // prisma/seed-data.ts, mirrors the legacy prices exactly). Each PDP
  // carries the same `.rr-section` as reviews.html, with the same
  // JS-injected (never-executed-by-the-static-extraction) review cards,
  // so the same supersetOk treatment applies for the same reason.
  { route: "/shop/model-x", legacyFile: "shop-model-x.html", supersetOk: true },
  {
    route: "/shop/model-001",
    legacyFile: "shop-model-001.html",
    supersetOk: true,
  },
  {
    route: "/shop/kids-model-123",
    legacyFile: "shop-kids-model-123.html",
    supersetOk: true,
  },
  { route: "/shop/socks", legacyFile: "shop-socks.html", supersetOk: true },
  {
    route: "/shop/stretch-laces",
    legacyFile: "shop-laces.html",
    supersetOk: true,
  },
];

for (const { route, legacyFile, supersetOk } of CASES) {
  test(`§2A.7 fidelity — ${route}`, async ({ page }) => {
    const legacy = extractLegacyPage(legacyFile);

    await page.goto(route);
    const mainHtml = await page.locator("#main").innerHTML();
    const migrated = extractStructure(mainHtml);

    if (supersetOk) {
      // Splits on the JS-injected-review-cards sentinel (see
      // isolateLegacyContent) so real, server-rendered review cards
      // sitting between two pieces of legacy static copy don't break an
      // otherwise-valid match — every other word must still appear, in
      // order, unaltered.
      assertSupersetAroundCardList(migrated.text, legacy.text);
    } else {
      expect(migrated.text, "visible text must match the legacy page").toBe(
        legacy.text,
      );
    }
    expect(
      migrated.headings,
      "heading tag/order/text must match the legacy page",
    ).toEqual(legacy.headings);
  });
}
