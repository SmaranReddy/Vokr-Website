// Phase 16 task 2 evidence: load every page route under the enforced CSP and
// fail on any violation (console "Content Security Policy" errors and
// `securitypolicyviolation` events), then prove enforcement with one
// negative probe: an inline script without the nonce must not run.
//
//   BASE_URL=http://127.0.0.1:3002 node e2e/csp-sweep.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3002";
const ROUTES = [
  "/", "/about-vokr", "/analyze-your-shoes", "/blog", "/community", "/discount-program", "/jobs",
  "/refer-a-friend", "/reviews", "/search", "/search?q=model", "/subscription", "/technology",
  "/vokr-ambassadors", "/wholesale-orders", "/why-vokr", "/privacy-policy", "/terms",
  "/support-contact", "/support-exchange-returns", "/support-faq", "/support-help", "/support-order-status",
  "/sign-in", "/sign-up", "/forgot-password", "/reset-password",
  "/shop/model-x", "/shop/model-001", "/shop/kids-model-123",
  "/checkout", "/orders", "/admin", "/no-such-page",
];

const browser = await chromium.launch();
const context = await browser.newContext();
let violations = 0;
for (const route of ROUTES) {
  const page = await context.newPage();
  const found = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (?:execute|load|apply|connect|frame)/i.test(message.text())) found.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const response = await page.goto(BASE + route, { waitUntil: "networkidle" });
  if (route === "/") {
    // The cart drawer: open it so its client code runs too.
    const bag = page.getByRole("button", { name: /bag|cart/i }).first();
    if (await bag.count()) await bag.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const hydrated = await page.evaluate(() => Boolean(document.querySelector("script[nonce]")));
  console.log(`${response?.status()} ${route} violations=${found.length} nonced_scripts=${hydrated}`);
  for (const line of found) console.log(`   ${line.slice(0, 200)}`);
  violations += found.length;
  await page.close();
}

// Negative probe: the real "/" response, its real CSP header, with two
// parser-inserted scripts added to the HTML that carry no nonce — one
// inline, one from a foreign origin. Both must be refused.
const probe = await context.newPage();
const probeViolations = [];
probe.on("console", (message) => {
  if (/Content Security Policy/i.test(message.text())) probeViolations.push(message.text());
});
await probe.route(BASE + "/", async (route) => {
  const response = await route.fetch();
  const html = (await response.text()).replace(
    "</head>",
    '<script>window.__cspProbe = true</script><script src="https://example.com/evil.js"></script></head>',
  );
  await route.fulfill({ response, body: html });
});
await probe.goto(BASE + "/", { waitUntil: "load" });
const ran = await probe.evaluate(() => window.__cspProbe === true);
const header = await (await context.request.get(BASE + "/")).headers()["content-security-policy"];
console.log(`probe: un-nonced inline ran=${ran} violations=${probeViolations.length} enforced_header=${Boolean(header)}`);
if (probeViolations.length < 2) console.log("probe: expected both injected scripts to be reported");
await browser.close();

if (violations > 0 || ran || probeViolations.length < 2) {
  console.log(`FAIL violations=${violations} probe_ran=${ran}`);
  process.exit(1);
}
console.log(`PASS ${ROUTES.length} routes, 0 violations; un-nonced inline and foreign scripts blocked`);
