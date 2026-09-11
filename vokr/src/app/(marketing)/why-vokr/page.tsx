import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `why-vokr.html` — Vokr-Implementation-Plan.md §2A's approved source of
 * truth. Section order, headings and body copy below are transcribed
 * verbatim from the legacy `.cp-hero` / `.cp-section` markup (CSS values
 * ignored per §2A; visual shape approximated with this codebase's
 * Tailwind tokens, see `src/app/page.tsx`). Header, nav, cart, search,
 * account panel and footer are provided globally by `src/app/layout.tsx`
 * and are not reproduced here. The legacy page has no closing CTA band —
 * it ends after the testimonial cards.
 */

export const metadata = createMetadata({
  title: "Why Vokr",
  alternates: { canonical: "/why-vokr" },
});

const REASONS = [
  {
    icon: "☁",
    title: "All-day cushioning",
    body: "A lightweight foam midsole that stays supportive from your morning commute to your last errand of the day.",
  },
  {
    icon: "✨",
    title: "No bad odors",
    body: "Copper-infused antimicrobial lining keeps bacteria — and the smell that comes with it — from building up.",
  },
  {
    icon: "💎",
    title: "Premium, honest materials",
    body: "Recycled knit uppers and natural rubber outsoles chosen for how they perform, not just how they photograph.",
  },
  {
    icon: "🌿",
    title: "Lower-impact by design",
    body: "We build with recycled materials wherever we can, and make shoes meant to last multiple seasons, not one.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Wore these through back-to-back client meetings and a flight to Delhi. Still felt like I'd just put them on.",
    name: "Rohan Sethi",
  },
  {
    quote:
      "Three weeks in Mumbai and I only packed one pair of shoes. That was a first.",
    name: "Priyanka Mehta",
  },
  {
    quote:
      "Six months. Every day. Office, gym, travel. These are the only shoes I reach for now.",
    name: "Aditya Reddy",
  },
];

export default function WhyVokrPage() {
  return (
    <>
      {/* HERO */}
      <section className="border-b border-border px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Why Vokr
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            Because your shoes shouldn&apos;t be the thing slowing your day
            down.
          </h1>
          <p className="text-lg leading-relaxed text-muted">
            Here&apos;s what actually makes Vokr different from the shoes
            sitting in your closet right now.
          </p>
        </div>
      </section>

      {/* BUILT FOR HOW YOU ACTUALLY MOVE */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Built for how you actually move
          </h2>
          <p className="mb-10 text-[15px] text-muted">
            Every part of a Vokr shoe is designed around real days, not
            showroom photos.
          </p>
          <ul className="space-y-6">
            {REASONS.map((reason) => (
              <li key={reason.title} className="flex gap-4">
                <div
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg"
                >
                  {reason.icon}
                </div>
                <div>
                  <h4 className="mb-1 text-base font-bold">{reason.title}</h4>
                  <p className="text-sm text-muted">{reason.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ONE SIZE PHILOSOPHY — dark section */}
      <section className="bg-black px-5 py-16 text-center text-white sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            One size philosophy, in Indian sizing
          </h2>
          <p className="mb-8 text-[15px] leading-relaxed text-white/70">
            We size every Vokr shoe in Indian/UK sizing — no confusing
            conversions, no guesswork. If you&apos;re between sizes, our fit
            quiz tells you exactly which way to go.
          </p>
          <Link
            href="/#fit-quiz"
            className="inline-block bg-white px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-black hover:opacity-90"
          >
            Find Your Fit &rarr;
          </Link>
        </div>
      </section>

      {/* WHAT PEOPLE SAY AFTER THEY SWITCH */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-10 text-3xl font-bold tracking-tight sm:text-4xl">
            What people say after they switch
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl border border-border-strong p-6">
                <p className="text-[15px] leading-relaxed">&quot;{t.quote}&quot;</p>
                <h4 className="mt-3.5 text-sm font-bold">{t.name}</h4>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
