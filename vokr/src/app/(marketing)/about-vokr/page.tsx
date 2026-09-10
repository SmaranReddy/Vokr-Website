import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `about-vokr.html` — Vokr-Implementation-Plan.md §2A's approved source
 * of truth. Section order, headings and body copy below are transcribed
 * verbatim from the legacy `.cp-hero` / `.cp-section` markup (CSS values
 * ignored per §2A; visual shape approximated with this codebase's
 * Tailwind tokens, see `src/app/page.tsx`). Header, nav, cart, search,
 * account panel and footer are provided globally by `src/app/layout.tsx`
 * and are not reproduced here.
 */

export const metadata = createMetadata({
  title: "About Vokr",
  alternates: { canonical: "/about-vokr" },
});

const BELIEFS = [
  {
    title: "Fewer, better pairs",
    body: "One shoe that works for the office, the airport, and the weekend beats a closet full of single-purpose pairs.",
  },
  {
    title: "Materials that earn their place",
    body: "Every material in a Vokr shoe is there because it does something — comfort, durability, or odor control. Nothing is decorative.",
  },
  {
    title: "Built for Indian summers",
    body: "We design and test in Indian conditions — heat, humidity, long commutes — not just in a lab overseas.",
  },
];

const STATS = [
  { num: "250K+", label: "Happy customers" },
  { num: "2021", label: "Founded" },
  { num: "4.7/5", label: "Average rating" },
  { num: "30-day", label: "Free returns" },
];

export default function AboutVokrPage() {
  return (
    <>
      {/* HERO */}
      <section className="border-b border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            About Vokr
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            We started Vokr because our own shoes were letting us down.
          </h1>
          <p className="text-lg leading-relaxed text-muted">
            Not falling apart — just never quite fitting the way our days
            actually went. Vokr is our answer: one shoe, built to do more of
            what you already do.
          </p>
        </div>
      </section>

      {/* WHERE IT STARTED */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
            Where it started
          </h2>
          <div className="space-y-4 text-[15px] leading-relaxed text-muted">
            <p>
              Vokr began in a small studio in Bengaluru with a simple
              frustration: most &quot;comfortable&quot; shoes were
              comfortable for an hour, not a workday. We wanted something
              that held up through client meetings, airport queues, evening
              walks, and everything in between — without needing a separate
              pair for each.
            </p>
            <p>
              So we spent a year testing materials most footwear brands
              don&apos;t bother with: copper-infused antimicrobial linings,
              stretch laces that never need retying, and foam soles
              engineered for all-day wear rather than a single sprint. The
              result was <strong>Model x</strong>, our first shoe, and the
              one that&apos;s still our most-worn style today.
            </p>
            <p>
              We&apos;re a small, independent team building shoes for people
              who don&apos;t want to think about their shoes — they just
              want them to work.
            </p>
          </div>
        </div>
      </section>

      {/* WHAT WE BELIEVE */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-10 text-3xl font-bold tracking-tight sm:text-4xl">
            What we believe
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {BELIEFS.map((belief) => (
              <div key={belief.title} className="rounded-2xl border border-border-strong p-6">
                <h4 className="mb-1.5 text-base font-bold">{belief.title}</h4>
                <p className="text-sm text-muted">{belief.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VOKR TODAY */}
      <section className="border-t border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto mb-10 max-w-2xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Vokr today
          </h2>
          <p className="text-[15px] text-muted">
            A small team, a growing community, and a product line we&apos;re
            still obsessing over.
          </p>
        </div>
        <div className="mx-auto grid max-w-3xl grid-cols-2 border-y border-border sm:grid-cols-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1.5 border-r border-border px-4 py-6 last:border-r-0"
            >
              <span className="text-2xl font-bold">{stat.num}</span>
              <span className="text-[11px] font-semibold tracking-[.1em] text-muted uppercase">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA BAND */}
      <section className="border-t border-border bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h3 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
          See what everyone&apos;s talking about.
        </h3>
        <p className="mb-7 text-[15px] text-muted">
          Take our 5-question quiz and find the Vokr pair made for you.
        </p>
        <Link
          href="/#fit-quiz"
          className="inline-block bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background hover:opacity-90"
        >
          Find Your Fit &rarr;
        </Link>
      </section>
    </>
  );
}
