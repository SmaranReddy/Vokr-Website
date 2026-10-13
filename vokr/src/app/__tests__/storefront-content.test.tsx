import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the storefront-only launch (§2A.6 rows R14, R20 and
 * L1). Renders every page that carried a removed claim, plus the global
 * header and footer, and asserts none of it comes back. Checked against
 * rendered markup rather than source, because source comments
 * legitimately describe what was removed and why.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/cart/cart-provider", () => ({
  useCart: () => ({ itemCount: 0, openCart: vi.fn() }),
}));

const pages: Record<string, () => Promise<ReactElement>> = {
  "/": async () => (await import("@/app/page")).default(),
  "/about-vokr": async () => (await import("@/app/(marketing)/about-vokr/page")).default(),
  "/why-vokr": async () => (await import("@/app/(marketing)/why-vokr/page")).default(),
  "/community": async () => (await import("@/app/(marketing)/community/page")).default(),
  "/blog": async () => (await import("@/app/(marketing)/blog/page")).default(),
  "/technology": async () => (await import("@/app/(marketing)/technology/page")).default(),
  "/reviews": async () => (await import("@/app/(marketing)/reviews/page")).default(),
  "/terms": async () => (await import("@/app/(legal)/terms/page")).default(),
  "/privacy-policy": async () => (await import("@/app/(legal)/privacy-policy/page")).default(),
  "/support-order-status": async () =>
    (await import("@/app/(support)/support-order-status/page")).default(),
  "/refer-a-friend": async () => (await import("@/app/(marketing)/refer-a-friend/page")).default(),
  "/vokr-ambassadors": async () =>
    (await import("@/app/(marketing)/vokr-ambassadors/page")).default(),
  "/wholesale-orders": async () =>
    (await import("@/app/(marketing)/wholesale-orders/page")).default(),
  "/discount-program": async () =>
    (await import("@/app/(marketing)/discount-program/page")).default(),
  "/analyze-your-shoes": async () =>
    (await import("@/app/(marketing)/analyze-your-shoes/page")).default(),
  "/subscription": async () => (await import("@/app/(marketing)/subscription/page")).default(),
  "/support-faq": async () => (await import("@/app/(support)/support-faq/page")).default(),
  "site header": async () => {
    const { SiteHeader } = await import("@/components/layout/site-header");
    return <SiteHeader />;
  },
  "site footer": async () => {
    const { SiteFooter } = await import("@/components/layout/site-footer");
    return <SiteFooter />;
  },
};

async function renderPage(name: string): Promise<string> {
  const load = pages[name];
  if (!load) throw new Error(`No page registered as "${name}"`);
  return renderToStaticMarkup(await load());
}

/** Claims removed because nothing substantiates them. */
const BANNED: { label: string; pattern: RegExp }[] = [
  { label: "unsupported customer count", pattern: /250,000|250K/i },
  { label: "unsupported average rating", pattern: /4\.7\b/ },
  { label: "unsupported review count", pattern: /4,059/ },
  { label: "recommend percentage", pattern: /94%/ },
  { label: "fabricated verified-buyer badge", pattern: /Verified Buyer/i },
  { label: "aggregate-rating structured data", pattern: /aggregateRating|application\/ld\+json/i },
  { label: "star rating glyphs", pattern: /★/ },
  {
    label: "attributed testimonial",
    pattern:
      /Rohan Sethi|Priyanka Mehta|Arjun Nair|Sneha Krishnan|Karan Kapoor|Aditya Reddy|Sequoia|Swiggy|Google India/,
  },
  { label: "fabricated social handle", pattern: /@(rohansethiblr|priyankamehta_vc|karankapoordesign|adityareddyblr)|deepika\.dayswear|arjun\.onthemove|karan\.streets|priya\.in\.motion|soles\.and\.souls/ },
  { label: "uncited press strip", pattern: /Humans of Bombay|Man(&#x27;|')s World|most thoughtfully designed/ },
  { label: "customer-behaviour claim", pattern: /most of our customers/ },
  { label: "SMS promise", pattern: /\bSMS\b/ },
  { label: "availability promise", pattern: /Available now|limited quantities/i },
  { label: "dead placeholder link", pattern: /href="#"/ },
  { label: "subscription offered as live", pattern: /Yes — Vokr Subscribe|You can pause or cancel anytime/ },
];

describe("storefront content — removed claims stay removed", () => {
  for (const name of Object.keys(pages)) {
    it(`${name} renders none of the removed claims`, async () => {
      const html = await renderPage(name);
      for (const { label, pattern } of BANNED) {
        expect(html, `${name}: ${label}`).not.toMatch(pattern);
      }
    });
  }

  it("the homepage offers no purchase action while ordering is disabled", async () => {
    const html = await renderPage("/");
    expect(html).not.toMatch(/Add to Cart/i);
    expect(html).toMatch(/Online ordering isn(&#x27;|')t open yet/);
  });

  it("reviews show an honest empty state", async () => {
    const html = await renderPage("/reviews");
    expect(html).toContain("Ratings and Reviews");
    expect(html).toContain("No reviews yet.");
  });

  it("the legal pages promise order confirmation by email only", async () => {
    const terms = await renderPage("/terms");
    expect(terms).toContain("order confirmation email with your order ID");
    const privacy = await renderPage("/privacy-policy");
    expect(privacy).toContain("Send you order updates via email and");
  });

  for (const name of Object.keys(pages)) {
    it(`${name}: every inert control explains itself in visible text`, async () => {
      const html = await renderPage(name);
      const doc = new DOMParser().parseFromString(html, "text/html");
      // `aria-disabled` marks the deliberately inert, always-unavailable
      // controls (D8 forms, Track Order). Transiently disabled ones, like
      // the fit quiz's "Back" on its first step, are not in scope.
      const inert = doc.querySelectorAll('[aria-disabled="true"]');
      for (const control of Array.from(inert)) {
        const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        expect(ids.length, `${name}: "${control.textContent}" has no description`).toBeGreaterThan(0);
        for (const id of ids) {
          const note = doc.getElementById(id);
          expect(note?.textContent?.trim(), `${name}: #${id} is empty`).toBeTruthy();
          expect(note?.classList.contains("sr-only"), `${name}: #${id} is not visible`).toBe(false);
        }
      }
    });
  }

  it.each([
    ["/subscription", "SUBSCRIPTION_UNAVAILABLE"],
    ["/refer-a-friend", "REFERRAL_UNAVAILABLE"],
    ["/discount-program", "DISCOUNT_UNAVAILABLE"],
    ["/vokr-ambassadors", "AMBASSADOR_UNAVAILABLE"],
  ] as const)("%s opens by marking its program as unavailable", async (name, key) => {
    const programs = await import("@/config/programs");
    const notice = programs[key];
    const html = await renderPage(name);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const first = doc.querySelector('[role="note"]');
    expect(first?.textContent).toBe(notice);
    // Nothing on the page may come before the notice except its wrapper.
    expect(html.indexOf(notice)).toBeLessThan(html.indexOf("<h1"));
  });

  it("the FAQ says there is no subscription plan", async () => {
    const html = await renderPage("/support-faq");
    expect(html).toContain("Not yet. Vokr Subscribe isn");
  });
});
