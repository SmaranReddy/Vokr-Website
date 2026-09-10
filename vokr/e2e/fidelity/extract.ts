import { readFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";

/**
 * §2A.7 fidelity extraction — shared by the legacy-source side and the
 * rendered-Next.js side of the comparison, so both go through identical
 * normalisation (Vokr-Implementation-Plan.md §2A.7 items 1–2).
 */

export interface PageStructure {
  text: string;
  headings: { tag: string; text: string }[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Legacy source HTML carries whitespace between sibling block tags
 * (`</p>\n\n<p>`) that a JSX-rendered tree does not (React emits
 * `<p>...</p><p>...</p>` with no text node between them) — `textContent`
 * would otherwise run adjacent blocks together as one word on one side
 * only. Inserting an explicit space after every block-ish closing tag,
 * before parsing, makes both sides of the §2A.7 comparison agree on
 * where a word boundary is regardless of source formatting.
 */
const BLOCK_TAGS =
  "p|h1|h2|h3|h4|h5|h6|li|div|section|article|header|footer|nav|ul|ol|table|tr|td|th|button|a|span|select|option|label";

function spaceBlockBoundaries(html: string): string {
  return html
    .replace(new RegExp(`</(${BLOCK_TAGS})>`, "gi"), "</$1> ")
    // <br> is void (no closing tag) — space after the tag itself, both
    // self-closing (JSX's <br />) and legacy's bare <br/>/<br> forms.
    .replace(/<br\s*\/?>/gi, "$& ");
}

/** Extracts visible text + ordered heading list from an HTML fragment (no `<html>`/`<body>` wrapper required). */
export function extractStructure(html: string): PageStructure {
  const dom = new JSDOM(`<!doctype html><body>${spaceBlockBoundaries(html)}</body>`);
  const doc = dom.window.document;
  // `.sr-only` (this codebase's visually-hidden-but-accessible convention,
  // e.g. a real <label> for an input the legacy only gave a placeholder)
  // is real DOM text but never visible on screen — excluded so an
  // approved accessibility improvement (task 12) doesn't read as a
  // content addition against the legacy page, which has no equivalent.
  doc.querySelectorAll("script, style, noscript, .sr-only").forEach((el) => el.remove());

  const text = normalizeWhitespace(doc.body.textContent ?? "");
  const headings = Array.from(
    doc.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  ).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: normalizeWhitespace(el.textContent ?? ""),
  }));

  return { text, headings };
}

/**
 * Isolates a legacy page's unique content — everything between the main
 * nav panel's close tag and the site footer's open tag. Excludes the
 * header, announcement bars, cart/search/account panels and footer,
 * which are reproduced once, globally, by `SiteHeader`/`SiteFooter`
 * rather than per page — see Phase 4 task 3's "SiteHeader"/"SiteFooter"
 * tasks and every migrated page's own doc comment.
 */
export function isolateLegacyContent(fullHtml: string): string {
  const navMatch = fullHtml.match(/<nav class="nav-panel"[\s\S]*?<\/nav>/);
  const startIdx = navMatch ? navMatch.index! + navMatch[0].length : 0;
  const footerIdx = fullHtml.indexOf('<footer class="site-footer">');
  const endIdx = footerIdx === -1 ? fullHtml.length : footerIdx;
  const content = fullHtml.slice(startIdx, endIdx);

  // `#rrModalOverlay` (reviews.html) is an empty detail-view template —
  // every field (title/body/name/photos) is blank in the static source
  // and filled in only by a click handler; the few static labels it does
  // carry ("Fit", "Size Purchased", the helpful-count default) describe
  // UI chrome for that interaction, not page content, so it is excluded
  // the same way the cart/search/account-panel chrome is (never sliced
  // in to begin with, since those sit outside the nav→footer boundary —
  // this one happens to sit inside it). Depth-counted rather than a
  // fixed-depth regex, since `<div>` nests arbitrarily inside it.
  return stripBalancedDiv(content, '<div class="rr-modal-overlay"');
}

/** Removes the first `<div ...>` matching `openTagPrefix` through its balanced closing `</div>`. */
function stripBalancedDiv(html: string, openTagPrefix: string): string {
  const start = html.indexOf(openTagPrefix);
  if (start === -1) return html;

  const divTag = /<div\b|<\/div>/g;
  divTag.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = divTag.exec(html))) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) {
      const end = match.index + match[0].length;
      return html.slice(0, start) + html.slice(end);
    }
  }
  return html;
}

/**
 * Reads one legacy page from the repo-tracked `vokr-production.zip`
 * (blob `02c5329`, §2A.1/§2A.8) and returns its isolated, extracted
 * structure. The zip — not an ad hoc extraction directory — is the
 * reproducible source so this check keeps working for anyone who clones
 * the repo, per §2A.7's closing line: "the legacy files stay in place
 * precisely so these checks remain runnable after the migration lands."
 */
export function extractLegacyPage(filename: string): PageStructure {
  const zipPath = path.resolve(__dirname, "../../../vokr-production.zip");
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(`vokr-production/${filename}`);
  if (!entry) {
    throw new Error(`vokr-production.zip has no entry "${filename}"`);
  }
  const html = entry.getData().toString("utf-8");
  return extractStructure(isolateLegacyContent(html));
}

/** Convenience: reads a local file directly (used by scripts outside the zip, if ever needed). */
export function extractLegacyPageFromFile(filePath: string): PageStructure {
  const html = readFileSync(filePath, "utf-8");
  return extractStructure(isolateLegacyContent(html));
}
