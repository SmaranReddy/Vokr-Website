import Link from "next/link";
import { NavMenu } from "@/components/layout/nav-menu";
import { HeaderSearch } from "@/components/layout/header-search";

/**
 * Reproduces the legacy `.site-header` (sticky bar, two announcement
 * lines, hamburger menu, search, account and cart affordances) —
 * Vokr-Implementation-Plan.md Phase 4 task 3. Link targets:
 * - "Find Your Fit" now resolves to `/#fit-quiz` everywhere rather than
 *   the legacy's page-relative `#fit-quiz` (which only ever worked on
 *   the homepage, since that section exists nowhere else) — the same
 *   label leading to the same destination, made to actually work
 *   site-wide; an implementation fix, not a content or nav change.
 * - The account icon links to the real `/sign-in` built in Phase 3,
 *   replacing the legacy's cosmetic slide-over sign-in panel, which the
 *   plan records this phase as *replacing* rather than migrating
 *   (§0.2 Phase 3 evidence log, item 12).
 * - The cart affordance is present (icon + count, matching the legacy
 *   `#cartToggle`) but inert: cart UI is explicitly out of scope for this
 *   phase ("Explicitly Out of Scope" — Cart and checkout UI belongs to
 *   Phases 5–7). Building a `/cart` destination here would be scope
 *   creep into Phase 5; shipping a link to nothing would be a dead
 *   affordance. `aria-disabled` plus a `title` say why, honestly, rather
 *   than either.
 */
export function SiteHeader() {
  return (
    <>
      <div className="border-b border-[#222] bg-black px-4 py-3 text-center text-[13px] text-white">
        Introducing Vokr Model x in White &amp; Black. Available now{" "}
        <Link href="/shop/model-x" className="underline underline-offset-2">
          &rarr;
        </Link>
      </div>
      <div className="border-b border-[#222] bg-black px-4 py-3 text-center text-[13px] text-white">
        Introducing Model 001 in Black.{" "}
        <Link href="/shop/model-001" className="underline underline-offset-2">
          Shop now &rarr;
        </Link>
      </div>

      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex h-[60px] max-w-[1440px] items-center justify-between px-5">
          <div className="flex items-center gap-6">
            <NavMenu />
            <Link
              href="/#fit-quiz"
              className="hidden text-[13px] font-semibold text-foreground sm:inline"
            >
              Find Your Fit
            </Link>
          </div>

          <Link
            href="/"
            className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
          >
            VOKR
          </Link>

          <div className="flex items-center gap-4">
            <Link href="/sign-in" aria-label="Account" className="p-1 text-foreground">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" />
              </svg>
            </Link>
            <HeaderSearch />
            <button
              type="button"
              aria-label="Your Cart"
              aria-disabled="true"
              title="Cart launches in a later phase"
              className="cursor-default text-[13px] font-semibold text-foreground"
            >
              Bag&thinsp;<span>0</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
