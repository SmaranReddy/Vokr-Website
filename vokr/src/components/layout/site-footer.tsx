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
            {/* `id="signup"` is the target of the `/#signup` links on
                /blog and /community, which had no destination before. */}
            <div id="signup" className="mb-10 max-w-[360px] scroll-mt-20">
              <NewsletterForm />
            </div>
            {/* "Stay Connected" and its Instagram / X / Facebook icons were
                removed under §2A.6 row L1: the legacy hrefs were literal "#"
                placeholders and no real handle is published, so they were
                dead links. Restore them once official profiles exist. */}
          </div>

          {FOOTER_LINK_GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="mb-4 text-xs font-bold tracking-[.1em] text-white">
                {group.title}
              </h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href} className="mb-[11px]">
                    {/* No viewport prefetch: ~20 footer routes cost ~130 KB per homepage view (R21). */}
                    <Link
                      href={link.href}
                      prefetch={false}
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
            <Link href="/terms" prefetch={false} className="hover:text-white">
              Terms &amp; Conditions
            </Link>
            <Link href="/privacy-policy" prefetch={false} className="hover:text-white">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
