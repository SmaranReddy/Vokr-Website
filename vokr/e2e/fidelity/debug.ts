import { chromium } from "@playwright/test";
import { extractLegacyPage, extractStructure } from "./extract";

async function main() {
  const route = process.argv[2] ?? "/terms";
  const legacyFile = process.argv[3] ?? "terms.html";

  const legacy = extractLegacyPage(legacyFile);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:3000${route}`);
  const mainHtml = await page.locator("#main").innerHTML();
  const migrated = extractStructure(mainHtml);
  await browser.close();

  console.log("legacy length:", legacy.text.length);
  console.log("migrated length:", migrated.text.length);

  let i = 0;
  const minLen = Math.min(legacy.text.length, migrated.text.length);
  while (i < minLen && legacy.text[i] === migrated.text[i]) i++;

  console.log("first diff at index", i);
  console.log("legacy   context:", JSON.stringify(legacy.text.slice(Math.max(0, i - 40), i + 40)));
  console.log("migrated context:", JSON.stringify(migrated.text.slice(Math.max(0, i - 40), i + 40)));

  console.log("\nheadings legacy:", JSON.stringify(legacy.headings));
  console.log("headings migrated:", JSON.stringify(migrated.headings));
}

main();
