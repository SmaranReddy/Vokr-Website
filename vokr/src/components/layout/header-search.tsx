"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The legacy header's search entry point (`#searchToggle` /
 * `#searchOverlay`), reproduced as an expanding panel rather than a
 * full-screen overlay — implementation detail, per task 2/3's "technical
 * migration is allowed". Submits to the real `/search` route (task 3's
 * "search entry point" requirement), which queries the Phase 2 catalog.
 *
 * The two suggestion rows below are the legacy `.search-suggest-label` /
 * `.search-chip` content, reproduced verbatim in the legacy's order. Each
 * legacy chip carried a `data-query` its script fed to the same search;
 * here the chip runs the same query against `/search`. `gift-cards` is
 * the one omission, per D1 (§2A.6) — the same treatment the footer and
 * hamburger nav already give it.
 */
const POPULAR_SEARCHES = [
  { label: "Model x", query: "Model x" },
  { label: "Model 001", query: "Model 001" },
  { label: "Socks", query: "Socks" },
  { label: "Kids Model 123", query: "Kids" },
  { label: "Black", query: "Black" },
  { label: "White", query: "White" },
];

const QUICK_LINKS = [
  { label: "Find Your Fit", href: "/#fit-quiz" },
  { label: "Order Status", href: "/support-order-status" },
  { label: "Exchange / Returns", href: "/support-exchange-returns" },
  { label: "FAQ", href: "/support-faq" },
  // "Gift Cards" intentionally omitted — D1, §2A.6.
];
export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  function go(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go(query);
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="flex items-center p-1 text-foreground"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="7.5" cy="7.5" r="5.5" />
          <path d="M13 13l3.5 3.5" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="relative">
      <form onSubmit={onSubmit} role="search" className="flex items-center gap-2">
        <label htmlFor="header-search-input" className="sr-only">
          Search Vokr
        </label>
        <input
          id="header-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Vokr"
          autoFocus
          className="w-32 border-b border-foreground bg-transparent text-sm outline-none sm:w-48"
        />
        <button
          type="button"
          aria-label="Close search"
          onClick={() => setOpen(false)}
          className="text-lg text-muted"
        >
          &times;
        </button>
      </form>

      <div className="absolute top-full right-0 z-50 mt-3 w-[min(88vw,340px)] border border-border bg-background p-4 shadow-lg">
        <p className="mb-2.5 text-[11px] font-semibold tracking-[.1em] text-subtle uppercase">
          Popular Searches
        </p>
        <div className="mb-5 flex flex-wrap gap-2">
          {POPULAR_SEARCHES.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => go(chip.query)}
              className="border border-border-strong px-3 py-1.5 text-[13px] text-foreground hover:bg-surface"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <p className="mb-2.5 text-[11px] font-semibold tracking-[.1em] text-subtle uppercase">
          Quick Links
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="border border-border-strong px-3 py-1.5 text-[13px] text-foreground hover:bg-surface"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
