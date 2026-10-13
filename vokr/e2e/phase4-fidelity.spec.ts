import { test, expect } from "@playwright/test";
import {
  extractLegacyPage,
  extractStructure,
  assertSupersetAroundCardList,
} from "./fidelity/extract";
import { ORDERING_UNAVAILABLE_MESSAGE } from "../src/config/commerce";

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

/**
 * One approved change to legacy content — §2A.6 rows R14 (SMS), R20
 * (fabricated reviews) and L1 (storefront-only launch). Applied to the
 * *legacy* side to produce the expected text, so the comparison stays
 * exact everywhere else. `legacy` must actually occur in the legacy text,
 * which keeps this register honest: a stale entry fails rather than
 * silently passing.
 */
interface Deviation {
  legacy: string | RegExp;
  migrated: string;
}

interface HeadingDeviations {
  /** Legacy heading texts whose element was removed. */
  removed?: string[];
  /** Legacy heading text → its replacement. */
  renamed?: Record<string, string>;
}

const REVIEWS_EMPTY_STATE =
  "No reviews yet. Customer reviews will appear here only once they come from verified purchases.";

// Every PDP and `/reviews`: everything after the "Ratings and Reviews"
// heading was fabricated (R20) and is replaced by an honest empty state.
const REVIEWS_DEVIATION: Deviation = {
  legacy: /94% of reviewers[\s\S]*$/,
  migrated: REVIEWS_EMPTY_STATE,
};

const PDP_DEVIATIONS: Deviation[] = [
  {
    legacy: "Add to Cart Free shipping",
    migrated: `Add to Cart ${ORDERING_UNAVAILABLE_MESSAGE} Free shipping`,
  },
  REVIEWS_DEVIATION,
];

const ORDER_STATUS_NOTE =
  "Online order tracking isn't available yet — online ordering hasn't opened, so there are no orders to track.";

const ORDER_STATUS_DEVIATIONS: Deviation[] = [
  {
    legacy: "Track Order Order confirmed",
    migrated: `Track Order ${ORDER_STATUS_NOTE} Order confirmed`,
  },
  { legacy: "by email and SMS the moment", migrated: "by email the moment" },
];

/** D8 forms: the submit label stays; a visible note follows the form. */
function formNote(label: string, note: string): Deviation {
  return { legacy: label, migrated: `${label} ${note}` };
}

function applyDeviations(text: string, deviations: Deviation[]): string {
  let expected = text;
  for (const { legacy, migrated } of deviations) {
    const present =
      typeof legacy === "string"
        ? expected.includes(legacy)
        : new RegExp(legacy.source).test(expected);
    expect(present, `registered deviation not found in legacy text: ${legacy}`).toBe(true);
    expected = expected.replace(legacy, migrated);
  }
  return expected.replace(/\s+/g, " ").trim();
}

function applyHeadingDeviations(
  headings: { tag: string; text: string }[],
  deviations: HeadingDeviations = {},
): { tag: string; text: string }[] {
  const all = [...(deviations.removed ?? []), ...Object.keys(deviations.renamed ?? {})];
  for (const text of all) {
    expect(
      headings.some((h) => h.text === text),
      `registered heading deviation not found in legacy headings: ${text}`,
    ).toBe(true);
  }
  return headings
    .filter((h) => !deviations.removed?.includes(h.text))
    .map((h) => ({ ...h, text: deviations.renamed?.[h.text] ?? h.text }));
}

interface FidelityCase {
  route: string;
  legacyFile: string;
  /**
   * The five PDPs render name, price and sizes from the live catalog,
   * so their expected text must appear, in order, inside the migrated
   * text rather than equal it.
   */
  supersetOk?: boolean;
  deviations?: Deviation[];
  headingDeviations?: HeadingDeviations;
}

const CASES: FidelityCase[] = [
  {
    route: "/",
    legacyFile: "index.html",
    deviations: [
      {
        legacy: "Available now in limited quantities.",
        migrated: "Online ordering isn't open yet.",
      },
      {
        legacy: /250,000\+ customers love their Vokr[\s\S]*?Google India · Hyderabad/,
        migrated: "",
      },
      { legacy: "Shop Model x in this size →", migrated: "View Model x →" },
      { legacy: /Add to Cart/g, migrated: "View Details" },
      {
        legacy:
          "deepika.dayswear arjun.onthemove karan.streets priya.in.motion soles.and.souls Follow @vokr",
        migrated: "",
      },
      {
        legacy: `"The most thoughtfully designed sneakers ever." Verve Man's World Humans of Bombay`,
        migrated: "",
      },
      ...ORDER_STATUS_DEVIATIONS,
    ],
    headingDeviations: { removed: ["What our customers say"] },
  },
  {
    route: "/terms",
    legacyFile: "terms.html",
    deviations: [
      { legacy: "confirmation email/SMS with", migrated: "confirmation email with" },
    ],
  },
  {
    route: "/privacy-policy",
    legacyFile: "privacy-policy.html",
    deviations: [
      { legacy: "via email/SMS and", migrated: "via email and" },
      {
        legacy: "marketing emails or SMS at any time",
        migrated: "marketing emails at any time",
      },
    ],
  },
  {
    route: "/support-order-status",
    legacyFile: "support-order-status.html",
    deviations: ORDER_STATUS_DEVIATIONS,
  },
  {
    route: "/support-exchange-returns",
    legacyFile: "support-exchange-returns.html",
  },
  { route: "/support-faq", legacyFile: "support-faq.html" },
  { route: "/support-help", legacyFile: "support-help.html" },
  { route: "/support-contact", legacyFile: "support-contact.html" },
  {
    route: "/about-vokr",
    legacyFile: "about-vokr.html",
    deviations: [
      {
        legacy:
          "250K+ Happy customers 2021 Founded 4.7/5 Average rating 30-day Free returns",
        migrated: "2021 Founded 30-day Free returns",
      },
    ],
  },
  {
    route: "/why-vokr",
    legacyFile: "why-vokr.html",
    deviations: [{ legacy: /What people say after they switch[\s\S]*$/, migrated: "" }],
    headingDeviations: {
      removed: [
        "What people say after they switch",
        "Rohan Sethi",
        "Priyanka Mehta",
        "Aditya Reddy",
      ],
    },
  },
  {
    route: "/technology",
    legacyFile: "technology.html",
    deviations: [
      {
        legacy: "days in a row, which is exactly how most of our customers wear them.",
        migrated: "days in a row.",
      },
    ],
  },
  {
    route: "/community",
    legacyFile: "community.html",
    deviations: [
      {
        legacy: "250,000+ people, one shoe they actually reach for every day.",
        migrated: "One shoe you actually reach for every day.",
      },
      { legacy: /From the community[\s\S]*?That was a first\."/, migrated: "" },
    ],
    headingDeviations: {
      removed: [
        "From the community",
        "@karankapoordesign",
        "@adityareddyblr",
        "@priyankamehta_vc",
      ],
      renamed: {
        "250,000+ people, one shoe they actually reach for every day.":
          "One shoe you actually reach for every day.",
      },
    },
  },
  {
    route: "/blog",
    legacyFile: "blog.html",
    deviations: [
      {
        legacy:
          "Community What 250,000 pairs of feet taught us about fit Patterns we noticed across thousands of customer fit-quiz responses, and how they shaped Model 001. Read more →",
        migrated: "",
      },
      { legacy: /Read more →/g, migrated: "Not yet published" },
    ],
    headingDeviations: { removed: ["What 250,000 pairs of feet taught us about fit"] },
  },
  { route: "/jobs", legacyFile: "jobs.html" },
  {
    route: "/vokr-ambassadors",
    legacyFile: "vokr-ambassadors.html",
    deviations: [
      formNote(
        "Submit Application",
        "Online ambassador applications aren't open yet, so this form can't be submitted.",
      ),
    ],
  },
  {
    route: "/wholesale-orders",
    legacyFile: "wholesale-orders.html",
    deviations: [
      formNote(
        "Submit Inquiry",
        "Online wholesale inquiries aren't available yet, so this form can't be submitted.",
      ),
    ],
  },
  {
    route: "/discount-program",
    legacyFile: "discount-program.html",
    deviations: [
      formNote(
        "Verify & Get Code",
        "Discount verification isn't available yet, so this form can't be submitted.",
      ),
    ],
  },
  {
    route: "/refer-a-friend",
    legacyFile: "refer-a-friend.html",
    deviations: [
      formNote(
        "Get My Link",
        "Referral links aren't available yet, so this form can't be submitted.",
      ),
    ],
  },
  { route: "/subscription", legacyFile: "subscription.html" },
  {
    route: "/analyze-your-shoes",
    legacyFile: "analyze-your-shoes.html",
    deviations: [
      formNote(
        "Analyze My Shoes",
        "Shoe photo analysis isn't available yet, so this form can't be submitted.",
      ),
    ],
  },
  { route: "/reviews", legacyFile: "reviews.html", deviations: [REVIEWS_DEVIATION] },
  // The 5 dynamic PDP routes (task 5) — name/price/sizes come from the
  // live Phase 2 catalog (seeded to mirror the legacy prices exactly).
  {
    route: "/shop/model-x",
    legacyFile: "shop-model-x.html",
    supersetOk: true,
    deviations: PDP_DEVIATIONS,
  },
  {
    route: "/shop/model-001",
    legacyFile: "shop-model-001.html",
    supersetOk: true,
    deviations: PDP_DEVIATIONS,
  },
  {
    route: "/shop/kids-model-123",
    legacyFile: "shop-kids-model-123.html",
    supersetOk: true,
    deviations: PDP_DEVIATIONS,
  },
  {
    route: "/shop/socks",
    legacyFile: "shop-socks.html",
    supersetOk: true,
    deviations: PDP_DEVIATIONS,
  },
  {
    route: "/shop/stretch-laces",
    legacyFile: "shop-laces.html",
    supersetOk: true,
    deviations: PDP_DEVIATIONS,
  },
];

for (const { route, legacyFile, supersetOk, deviations = [], headingDeviations } of CASES) {
  test(`§2A.7 fidelity — ${route}`, async ({ page }) => {
    const legacy = extractLegacyPage(legacyFile);
    const expectedText = applyDeviations(legacy.text, deviations);
    const expectedHeadings = applyHeadingDeviations(legacy.headings, headingDeviations);

    await page.goto(route);
    const mainHtml = await page.locator("#main").innerHTML();
    const migrated = extractStructure(mainHtml);

    if (supersetOk) {
      assertSupersetAroundCardList(migrated.text, expectedText);
    } else {
      expect(migrated.text, "visible text must match the legacy page").toBe(
        expectedText,
      );
    }
    expect(
      migrated.headings,
      "heading tag/order/text must match the legacy page",
    ).toEqual(expectedHeadings);
  });
}
