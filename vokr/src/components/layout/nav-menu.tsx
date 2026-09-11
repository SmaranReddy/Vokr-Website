"use client";

import { useState } from "react";
import Link from "next/link";
import { HEADER_NAV_GROUPS } from "@/config/nav";

/**
 * The legacy hamburger panel (`#mainNavPanel`) reproduced as an
 * accessible disclosure — same three groups, same order, same links
 * (Vokr-Implementation-Plan.md §2A.4). Isolated as its own client
 * component so `SiteHeader` and the marketing pages around it stay
 * server-rendered.
 */
export function NavMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="main-nav-panel"
        className="flex items-center gap-2 text-[13px] font-semibold tracking-widest text-foreground uppercase"
      >
        <span className="flex w-[18px] flex-col gap-1" aria-hidden="true">
          <i className="block h-[1.5px] rounded bg-foreground" />
          <i className="block h-[1.5px] rounded bg-foreground" />
          <i className="block h-[1.5px] rounded bg-foreground" />
        </span>
        Menu
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/35"
          />
          <nav
            id="main-nav-panel"
            aria-label="Main"
            className="relative flex h-full w-[360px] max-w-[88vw] flex-col overflow-y-auto bg-background"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
              <span className="text-xl font-extrabold tracking-tight">
                VOKR
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-surface text-[17px] text-foreground/70 hover:bg-border-strong"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 px-5 pt-6 pb-10">
              {HEADER_NAV_GROUPS.map((group) => (
                <div key={group.title} className="mb-7">
                  <p className="mb-3 px-1 text-[11px] font-bold tracking-[.12em] text-subtle uppercase">
                    {group.title}
                  </p>
                  <ul>
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          onClick={() => setOpen(false)}
                          className="block px-1 py-2.5 text-[15px] font-semibold text-foreground hover:text-muted"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
