import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `technology.html` — Vokr-Implementation-Plan.md §2A's approved source
 * of truth. Section order, headings and body copy below are transcribed
 * verbatim from the legacy `.cp-hero` / `.cp-section` markup (CSS values
 * ignored per §2A; visual shape approximated with this codebase's
 * Tailwind tokens, see `src/app/page.tsx`). Header, nav, cart, search,
 * account panel and footer are provided globally by `src/app/layout.tsx`
 * and are not reproduced here.
 */

export const metadata = createMetadata({
  title: "Technology",
  alternates: { canonical: "/technology" },
});

const LAYERS = [
  {
    tag: "Layer 1",
    title: "Cushioned sockliner",
    body: "A removable, memory-foam-style sockliner that molds to your foot over the first few wears.",
  },
  {
    tag: "Layer 2",
    title: "Lightweight foam midsole",
    body: "Absorbs impact on hard city pavement while staying light enough to forget you're wearing shoes at all.",
  },
  {
    tag: "Layer 3",
    title: "Natural rubber outsole",
    body: "Grippy, durable, and flexible enough to move naturally with each step.",
  },
];

export default function TechnologyPage() {
  return (
    <>
      {/* HERO */}
      <section className="border-b border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Technology
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            What&apos;s actually inside a Vokr shoe.
          </h1>
          <p className="text-lg leading-relaxed text-muted">
            No marketing fluff — here&apos;s the real materials science
            behind the comfort, the odor control, and the fit.
          </p>
        </div>
      </section>

      {/* COMFORT FORMULA */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Comfort Formula
          </h2>
          <p className="mb-10 max-w-lg text-[15px] text-muted">
            A three-layer system engineered for all-day wear, not just
            first-step comfort.
          </p>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {LAYERS.map((layer) => (
              <div key={layer.tag} className="rounded-2xl border border-border-strong p-6">
                <span className="mb-3 inline-block text-[11px] font-semibold tracking-[.1em] text-muted uppercase">
                  {layer.tag}
                </span>
                <h4 className="mb-1.5 text-base font-bold">{layer.title}</h4>
                <p className="text-sm text-muted">{layer.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COPPER-INFUSED LINING — dark section */}
      <section className="bg-black px-5 py-16 text-center text-white sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Copper-Infused Lining
          </h2>
          <p className="text-[15px] leading-relaxed text-white/70">
            Every Vokr shoe uses a copper-infused antimicrobial lining.
            Copper ions naturally disrupt the bacteria that cause shoe odor,
            so your pair stays fresher for longer — even worn two or three
            days in a row, which is exactly how most of our customers wear
            them.
          </p>
        </div>
      </section>

      {/* STRETCH LACE SYSTEM */}
      <section className="px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Stretch Lace System
          </h2>
          <p className="text-[15px] leading-relaxed text-muted">
            Tie your Vokr shoes once. The stretch laces flex with your foot
            as you slip the shoe on and off, so you get a snug, secure fit
            without ever having to retie — ideal for the mornings when
            you&apos;re already running late.
          </p>
        </div>
      </section>

      {/* BUILT & TESTED IN INDIA */}
      <section className="border-t border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Built &amp; tested in India
          </h2>
          <p className="text-[15px] leading-relaxed text-muted">
            We test every Vokr shoe in real Indian conditions — heat,
            humidity, monsoon commutes — not just controlled lab
            environments, so the comfort claims hold up outside the box.
          </p>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="border-t border-border bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h3 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Feel it for yourself.
        </h3>
        <p className="mb-7 text-[15px] text-muted">
          Take our fit quiz and get matched to your Indian/UK size in under a
          minute.
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
