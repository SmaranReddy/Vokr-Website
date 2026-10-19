/**
 * Homepage transfer weight in a real browser (plan §5 Phase 14, R21: under
 * 500 KB). The CI gate (`check-homepage-weight.ts`) measures JavaScript only;
 * this measures everything a visitor downloads, images included.
 *
 *   tsx scripts/assets/measure-homepage.ts --url http://localhost:3000/
 *
 * Loads the page in Chromium at a phone (390×844 @2x) and a desktop
 * (1440×900 @1x) viewport, scrolls to the bottom so lazy images load, and
 * sums the encoded bytes of every response, by resource type.
 */
import { chromium, type Page } from "@playwright/test";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function measure(page: Page, url: string) {
  const byType: Record<string, number> = {};
  const hosts: Record<string, number> = {};
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  const types = new Map<string, string>();
  client.on("Network.responseReceived", (event) => types.set(event.requestId, `${event.type}|${new URL(event.response.url).host}`));
  client.on("Network.loadingFinished", (event) => {
    const [type = "Other", host = "?"] = (types.get(event.requestId) ?? "").split("|");
    byType[type] = (byType[type] ?? 0) + event.encodedDataLength;
    hosts[host] = (hosts[host] ?? 0) + event.encodedDataLength;
  });
  await page.goto(url, { waitUntil: "networkidle" });
  for (let y = 0; y < 20; y += 1) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState("networkidle");
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  return { totalKB: Math.round(total / 1024), byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), hostsKB: Object.fromEntries(Object.entries(hosts).map(([k, v]) => [k, Math.round(v / 1024)])) };
}

async function main(): Promise<void> {
  const url = arg("url") ?? "http://localhost:3000/";
  const browser = await chromium.launch();
  const result: Record<string, unknown> = {};
  for (const [name, viewport, deviceScaleFactor] of [
    ["phone 390x844@2x", { width: 390, height: 844 }, 2],
    ["desktop 1440x900@1x", { width: 1440, height: 900 }, 1],
  ] as const) {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    result[name] = await measure(await context.newPage(), url);
    await context.close();
  }
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
