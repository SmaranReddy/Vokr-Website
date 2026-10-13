import { test, expect } from "@playwright/test";
import { MARKETING_ROUTES, SHOP_SLUGS } from "../src/config/nav";
import { ORDERING_UNAVAILABLE_MESSAGE } from "../src/config/commerce";

/**
 * Storefront-only launch gate (Vokr-Implementation-Plan.md §2A.6 rows
 * R14, R20, L1). Runs against the real built app, over every route the
 * sitemap publishes:
 *
 * - none of the removed claims comes back anywhere in the served HTML,
 *   `<head>` (meta description, structured data) included;
 * - no placeholder `href="#"`, every internal link resolves, and every
 *   same-page/cross-page `#fragment` has a target;
 * - no purchase can be started, and the reason is visible;
 * - no uncaught runtime errors.
 */

const SHOP_ROUTES = SHOP_SLUGS.map((slug) => `/shop/${slug}`);
const ALL_ROUTES = [...MARKETING_ROUTES, ...SHOP_ROUTES];

const BANNED: { label: string; pattern: RegExp }[] = [
  { label: "unsupported customer count", pattern: /250,000|250K/i },
  { label: "unsupported average rating", pattern: /\b4\.7\b/ },
  { label: "unsupported review count", pattern: /4,059/ },
  { label: "recommend percentage", pattern: /94% of reviewers/ },
  { label: "fabricated verified-buyer badge", pattern: /Verified Buyer/i },
  { label: "aggregate-rating structured data", pattern: /aggregateRating|reviewCount|ratingValue/i },
  {
    label: "attributed testimonial",
    pattern:
      /Rohan Sethi|Priyanka Mehta|Arjun Nair|Sneha Krishnan|Karan Kapoor|Aditya Reddy|Sequoia|Swiggy|Google India/,
  },
  { label: "uncited press strip", pattern: /Humans of Bombay|most thoughtfully designed/ },
  { label: "SMS promise", pattern: /\bSMS\b/ },
  { label: "availability promise", pattern: /Available now|limited quantities/i },
];

test.describe("storefront launch — removed claims stay removed", () => {
  for (const route of ALL_ROUTES) {
    test(`claims: ${route}`, async ({ request }) => {
      const response = await request.get(route);
      expect(response.status(), `${route} should return 200`).toBe(200);
      const html = await response.text();
      for (const { label, pattern } of BANNED) {
        expect(html, `${route}: ${label}`).not.toMatch(pattern);
      }
    });
  }
});

test.describe("storefront launch — links and runtime errors", () => {
  for (const route of ALL_ROUTES) {
    test(`links: ${route}`, async ({ page, request, baseURL }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));

      expect(hrefs, `${route} must not contain placeholder links`).not.toContain("#");

      const origin = new URL(baseURL!).origin;
      for (const href of new Set(hrefs)) {
        if (/^(mailto|tel):/.test(href)) continue;
        const url = new URL(href, `${origin}${route}`);
        if (url.origin !== origin) continue;

        const response = await request.get(url.pathname + url.search);
        expect(response.status(), `${route} links to ${href}`).toBeLessThan(400);

        if (url.hash.length > 1) {
          const target = decodeURIComponent(url.hash.slice(1));
          const html = await response.text();
          expect(
            html.includes(`id="${target}"`),
            `${route} links to ${href}, but no element has id="${target}"`,
          ).toBe(true);
        }
      }

      expect(pageErrors, `${route} threw at runtime`).toEqual([]);
    });
  }
});

test.describe("storefront launch — purchasing is unavailable", () => {
  for (const route of SHOP_ROUTES) {
    test(`PDP: ${route}`, async ({ page }) => {
      await page.goto(route);

      // Select the first size that can be selected, if any, to prove the
      // gate holds even when a variant is purchasable.
      const enabledSize = page
        .locator("button[aria-pressed]:not([disabled])")
        .first();
      if (await enabledSize.count()) await enabledSize.click();

      const addToCart = page.getByRole("button", { name: "Add to Cart" });
      await expect(addToCart).toBeDisabled();
      await expect(addToCart).toHaveAccessibleDescription(ORDERING_UNAVAILABLE_MESSAGE);
      const note = page.locator("#pdp-ordering-unavailable");
      await expect(note).toBeVisible();
      await expect(note).toHaveText(ORDERING_UNAVAILABLE_MESSAGE);
    });
  }

  test("cart drawer explains that ordering is unavailable", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Your Cart" }).click();
    const drawer = page.getByRole("dialog", { name: "Your Cart" });
    await expect(drawer.getByText(ORDERING_UNAVAILABLE_MESSAGE)).toBeVisible();
    const checkout = drawer.getByRole("button", { name: "Checkout" });
    if (await checkout.count()) await expect(checkout).toBeDisabled();
  });

  test("homepage product cards offer no purchase action", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#main").getByText("Add to Cart")).toHaveCount(0);
  });
});
