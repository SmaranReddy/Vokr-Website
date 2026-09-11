import { test } from "@playwright/test";
import { MARKETING_ROUTES, SHOP_SLUGS } from "../src/config/nav";

/**
 * Phase 4 responsive evidence — Vokr-Implementation-Plan.md's Testing
 * Requirements ("Responsive screenshots at the four breakpoints") and
 * §2A.7 item 4 ("Responsive screenshots at 360/768/1024/1440 px,
 * retained alongside the legacy rendering for visual comparison").
 * Screenshots land in `e2e/screenshots/` (git-ignored — evidence
 * artefacts, not source).
 */

const BREAKPOINTS = [
  { name: "360", width: 360, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 900 },
  { name: "1440", width: 1440, height: 1000 },
];

const ROUTES = [
  ...MARKETING_ROUTES,
  ...SHOP_SLUGS.map((slug) => `/shop/${slug}`),
];

for (const route of ROUTES) {
  for (const bp of BREAKPOINTS) {
    test(`screenshot ${route} @ ${bp.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(route);
      const fileSlug = route === "/" ? "home" : route.replace(/\//g, "_");
      await page.screenshot({
        path: `e2e/screenshots/${fileSlug}__${bp.name}.png`,
        fullPage: true,
      });
    });
  }
}
