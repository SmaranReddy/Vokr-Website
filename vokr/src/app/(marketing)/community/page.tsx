import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `community.html` — Vokr-Implementation-Plan.md §2A's approved source
 * of truth. Section order, headings and body copy below are transcribed
 * verbatim from the legacy `.cp-hero` / `.cp-section` markup (CSS values
 * ignored per §2A; visual shape approximated with this codebase's
 * Tailwind tokens, see `src/app/page.tsx`). Header, nav, cart, search,
 * account panel and footer are provided globally by `src/app/layout.tsx`
 * and are not reproduced here.
 *
 * The legacy CTA band links to `index.html#signup`; there is no `#signup`
 * anchor anywhere in this app (no newsletter section carries that id), so
 * this is mapped to `/#signup` per the plan's general "same slug, keep
 * fragment" rule — the link resolves to the homepage even though the
 * fragment currently matches nothing. Flagged in the migration report.
 */

export const metadata = createMetadata({
  title: "Community",
  alternates: { canonical: "/community" },
});

const BENEFITS = [
  {
    title: "First access",
    body: "New colorways and styles go to the community before they hit the general site.",
  },
  {
    title: "Real influence",
    body: "We run regular surveys and beta-test new materials with community members before wide release.",
  },
  {
    title: "City meetups",
    body: "Occasional in-person meetups in Bengaluru, Mumbai, and Delhi — part product feedback session, part hangout.",
  },
];

export default function CommunityPage() {
  return (
    <>
      {/* HERO */}
      <section className="border-b border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Community
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            One shoe you actually reach for every day.
          </h1>
          <p className="text-lg leading-relaxed text-muted">
            The Vokr community is where customers, ambassadors, and our own
            team swap fit tips, share their pairs, and shape what we build
            next.
          </p>
        </div>
      </section>

      {/* WHAT BEING PART OF THE COMMUNITY MEANS */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-10 text-3xl font-bold tracking-tight sm:text-4xl">
            What being part of the community means
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="rounded-2xl border border-border-strong p-6">
                <h4 className="mb-1.5 text-base font-bold">{benefit.title}</h4>
                <p className="text-sm text-muted">{benefit.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FROM THE COMMUNITY — removed under §2A.6 row L1: three quotes
          attributed to social handles that could not be substantiated. */}

      {/* CTA BAND */}
      <section className="border-t border-border bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h3 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Join the Vokr community.
        </h3>
        <p className="mb-7 text-[15px] text-muted">
          Get first access to new products, community events, and founder
          updates.
        </p>
        <Link
          href="/#signup"
          className="inline-block bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background hover:opacity-90"
        >
          Sign Up &rarr;
        </Link>
      </section>
    </>
  );
}
