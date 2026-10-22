import { test, expect } from "@playwright/test";
import {
  extractLegacyPage,
  extractStructure,
  assertSupersetAroundCardList,
} from "./fidelity/extract";
import { ORDERING_UNAVAILABLE_MESSAGE } from "../src/config/commerce";
import {
  AMBASSADOR_PROGRAM,
  DISCOUNT_PROGRAM,
  REFERRAL_PROGRAM,
  SUBSCRIPTION_PROGRAM,
} from "../src/config/programs";

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
  /** Legacy heading text → the tag it now renders as (same text). */
  retagged?: Record<string, string>;
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
  // No free shipping: always charged, by PIN code (owner decision, 21 Oct 2026).
  {
    legacy: "Free shipping on orders over ₹4,999. Free 30-day",
    migrated: "Shipping calculated at checkout. Free 30-day",
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

// The homepage "Contact Us" accordion and /support-contact listed a
// placeholder phone number and a chat that does not exist; both were
// removed (production audit, 20 Oct 2026), not replaced.
const CONTACT_DEVIATIONS: Deviation[] = [
  { legacy: "Phone +91 80 0000 0000 Hours", migrated: "Hours" },
  { legacy: "IST Chat Available on this page during business hours", migrated: "IST" },
];
const CONTACT_REMOVED_HEADINGS = ["Phone", "Chat"];

// The /support-faq page answered "Yes"
// to a subscription plan that does not exist.
const FAQ_SUBSCRIPTION_DEVIATION: Deviation = {
  legacy:
    "Yes — Vokr Subscribe delivers a fresh pair every 3, 6, or 12 months at 15% off. You can pause or cancel anytime.",
  migrated:
    "No. Vokr Subscribe isn't available and offers no subscriptions, discounts or other benefits at this time.",
};

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
  const all = [
    ...(deviations.removed ?? []),
    ...Object.keys(deviations.renamed ?? {}),
    ...Object.keys(deviations.retagged ?? {}),
  ];
  for (const text of all) {
    expect(
      headings.some((h) => h.text === text),
      `registered heading deviation not found in legacy headings: ${text}`,
    ).toBe(true);
  }
  return headings
    .filter((h) => !deviations.removed?.includes(h.text))
    .map((h) => ({
      tag: deviations.retagged?.[h.text] ?? h.tag,
      text: deviations.renamed?.[h.text] ?? h.text,
    }));
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
      ...CONTACT_DEVIATIONS,
    ],
    headingDeviations: { removed: ["What our customers say", ...CONTACT_REMOVED_HEADINGS] },
  },
  {
    route: "/terms",
    legacyFile: "terms.html",
    deviations: [
      { legacy: "confirmation email/SMS with", migrated: "confirmation email with" },
      // No COD, and shipping always charged by PIN code (owner decisions, 21 Oct 2026).
      {
        legacy:
          "Cash on Delivery (COD) is available on eligible orders and PIN codes, subject to a nominal COD handling fee shown at checkout. Prepaid orders are prioritized for faster dispatch.",
        migrated: "We do not offer Cash on Delivery (COD).",
      },
      {
        legacy: "you can check this at checkout. Delivery timelines",
        migrated:
          "you can check this at checkout. Shipping charges depend on your PIN code and are shown at checkout. Delivery timelines",
      },
      {
        legacy:
          " Refunds for COD orders are issued via bank transfer or Vokr store credit, as selected by you at the time of the return request.",
        migrated: "",
      },
      { legacy: "placing fraudulent COD orders", migrated: "placing fraudulent orders" },
      { legacy: "repeated COD refusals", migrated: "repeated refused deliveries" },
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
      // No COD (owner decision, 21 Oct 2026).
      { legacy: "size and fit preferences, COD vs. prepaid preference", migrated: "size and fit preferences" },
      { legacy: "including COD verification, shipping, and returns", migrated: "including shipping and returns" },
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
    deviations: [
      // No COD (owner decision, 21 Oct 2026).
      {
        legacy:
          "Refunds for prepaid orders go back to your original payment method within 5-7 business days; refunds for Cash on Delivery (COD) orders are sent via bank transfer or Vokr store credit — your choice.",
        migrated: "Refunds go back to your original payment method within 5-7 business days.",
      },
    ],
  },
  {
    route: "/support-faq",
    legacyFile: "support-faq.html",
    deviations: [FAQ_SUBSCRIPTION_DEVIATION],
  },
  { route: "/support-help", legacyFile: "support-help.html" },
  {
    route: "/support-contact",
    legacyFile: "support-contact.html",
    deviations: CONTACT_DEVIATIONS,
    headingDeviations: { removed: CONTACT_REMOVED_HEADINGS },
  },
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
    route: "/analyze-your-shoes",
    legacyFile: "analyze-your-shoes.html",
    deviations: [
      formNote(
        "Analyze My Shoes",
        "Shoe photo analysis isn't available yet, so this form can't be submitted.",
      ),
    ],
  },
  {
    route: "/reviews",
    legacyFile: "reviews.html",
    deviations: [REVIEWS_DEVIATION],
    // The legacy page had no h1; on /reviews its section heading is the
    // page's main heading (production audit, 20 Oct 2026). PDPs keep h2.
    headingDeviations: { retagged: { "Ratings and Reviews": "h1" } },
  },
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

// §2A.6 row L1: these four legacy pages advertised programs that do not
// exist. Their legacy content is withdrawn entirely, so there is no text to
// diff; instead each route must render exactly the program's name and its
// unavailability notice.
for (const [route, program] of [
  ["/subscription", SUBSCRIPTION_PROGRAM],
  ["/refer-a-friend", REFERRAL_PROGRAM],
  ["/discount-program", DISCOUNT_PROGRAM],
  ["/vokr-ambassadors", AMBASSADOR_PROGRAM],
] as const) {
  test(`§2A.6 L1 withdrawn program — ${route}`, async ({ page }) => {
    await page.goto(route);
    const migrated = extractStructure(await page.locator("#main").innerHTML());
    expect(migrated.text).toBe(`${program.name} ${program.notice} Back to home →`);
    expect(migrated.headings).toEqual([{ tag: "h1", text: program.name }]);
  });
}
