"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * The legacy header's search entry point (`#searchToggle` /
 * `#searchOverlay`), reproduced as an expanding field rather than a
 * full-screen overlay — implementation detail, per task 2/3's "technical
 * migration is allowed". Submits to the real `/search` route (task 3's
 * "search entry point" requirement), which queries the Phase 2 catalog.
 */
export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    setOpen(false);
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
  );
}
