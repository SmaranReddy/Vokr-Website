import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MARKETING_ROUTES, SHOP_SLUGS } from "../src/config/nav";

/**
 * Phase 4 (Website / Page Migration) route + accessibility gate —
 * Vokr-Implementation-Plan.md's Testing Requirements: "Route tests: all
 * 27 [26, gift-cards excluded by D1] destinations return 200; no route
 * 404s or 500s" and "Accessibility: automated axe pass on every route,
 * zero serious/critical violations."
 */

const SHOP_ROUTES = SHOP_SLUGS.map((slug) => `/shop/${slug}`);
const ALL_ROUTES = [...MARKETING_ROUTES, ...SHOP_ROUTES];

test.describe("Phase 4 — every migrated route returns 200", () => {
  for (const route of ALL_ROUTES) {
    test(`GET ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should return 200`).toBe(200);
    });
  }

  test("gift-cards is not reachable (D1)", async ({ page }) => {
    const response = await page.goto("/gift-cards");
    expect(response?.status()).toBe(404);
  });
});

test.describe("Phase 4 — zero serious/critical axe violations", () => {
  for (const route of ALL_ROUTES) {
    test(`axe: ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious,
        serious
          .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
          .join("\n"),
      ).toEqual([]);
    });
  }
});
