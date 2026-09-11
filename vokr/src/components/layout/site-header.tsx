"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/cart-provider";
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
 * - The cart affordance (icon + count, matching the legacy `#cartToggle`)
 *   now opens the real cart drawer built in Phase 5
 *   (`src/components/cart/cart-drawer.tsx`), reading its count from
 *   `CartProvider` — see `src/app/layout.tsx`.
 */
export function SiteHeader() {
  const { itemCount, openCart } = useCart();

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
              // `.header-fit-link` is hidden below the legacy's 700px breakpoint.
              className="hidden text-[13px] font-semibold text-foreground mid:inline"
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
              onClick={openCart}
              className="text-[13px] font-semibold text-foreground"
            >
              Bag&thinsp;<span>{itemCount}</span>
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
