import Link from "next/link";
import { FOOTER_LINK_GROUPS } from "@/config/nav";
import { NewsletterForm } from "@/components/marketing/newsletter-form";

/**
 * Reproduces the legacy `.site-footer` — join-community block with the
 * real newsletter form (task 10), three link columns (task 3), and the
 * copyright/legal bottom bar. Section order, column order and link
 * labels are unchanged from `vokr-production/index.html` (§2A.4);
 * `gift-cards.html` is omitted from the Products column per D1 (§2A.6).
 */
export function SiteFooter() {
  return (
    <footer className="bg-black px-5 pt-16 pb-7 text-white">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-14 text-2xl font-extrabold tracking-tight">
          VOKR
        </div>

        {/* `.footer-top-grid`: four columns at ≥901px, two at 541–900px,
            one at ≤540px — the legacy's breakpoints, not Tailwind's. */}
        <div className="mb-14 grid grid-cols-1 gap-8 narrow:grid-cols-2 wide:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <h2 className="mb-3.5 text-[15px] font-extrabold tracking-tight uppercase">
              Join the Vokr community.
            </h2>
            <p className="mb-5 max-w-[340px] text-[13px] leading-relaxed text-white/60">
              Get first access to new products, community events and founder
              updates.*
            </p>
            <div className="mb-10 max-w-[360px]">
              <NewsletterForm />
            </div>
            <p className="mb-3.5 text-xs font-semibold text-white/60">
              Stay Connected
            </p>
            {/* Legacy hrefs are literal "#" placeholders — no real handle is
                published in the approved content, so none is invented here (§2A.4). */}
            <div className="flex gap-3">
              <a
                href="#"
                aria-label="Instagram"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/20 text-white/80 hover:border-white hover:bg-white hover:text-black"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a
                href="#"
                aria-label="X"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/20 text-white/80 hover:border-white hover:bg-white hover:text-black"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M15.2 1.9h2.75l-6 6.9 7.07 9.3H13.4l-4.34-5.67-4.96 5.67H1.4l6.44-7.35L1.05 1.9H6.7l3.93 5.19L15.2 1.9zm-.97 14.6h1.52L5.9 3.45H4.27l10 13.05z" />
                </svg>
              </a>
              <a
                href="#"
                aria-label="Facebook"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/20 text-white/80 hover:border-white hover:bg-white hover:text-black"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z" />
                </svg>
              </a>
            </div>
          </div>

          {FOOTER_LINK_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="mb-4 text-xs font-bold tracking-[.1em] text-white">
                {group.title}
              </h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href} className="mb-[11px]">
                    <Link
                      href={link.href}
                      className="text-[13.5px] text-white/60 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* `.footer-bottom` stacks below 541px. */}
        <div className="flex flex-col items-start gap-3 border-t border-white/10 pt-5.5 text-xs text-white/60 narrow:flex-row narrow:flex-wrap narrow:items-center narrow:justify-between">
          <span>&copy; 2026 VOKR INC.</span>
          <div className="flex gap-5">
            <Link href="/terms" className="hover:text-white">
              Terms &amp; Conditions
            </Link>
            <Link href="/privacy-policy" className="hover:text-white">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
