import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `subscription.html` — Vokr-Implementation-Plan.md §2A's approved
 * source of truth. Section order, headings and body copy below are
 * transcribed verbatim from the legacy file's `cp-hero` / `cp-section` /
 * `cp-cta-band` markup (header/nav/cart/search/account/footer are global
 * and skipped). Unlike the other three pages in this batch, this page has
 * no interactive form in its unique content — the CTA is a plain link.
 */

export const metadata = createMetadata({
  title: "Subscription",
  alternates: { canonical: "/subscription" },
});

const HOW_SUBSCRIBE_WORKS = [
  {
    step: "1",
    title: "Pick your style & frequency",
    body: "Choose any Vokr shoe and how often you'd like a fresh pair — every 3, 6, or 12 months.",
  },
  {
    step: "2",
    title: "Save automatically",
    body: "Subscribers get 15% off every shipment, with no minimum commitment.",
  },
  {
    step: "3",
    title: "Pause or cancel anytime",
    body: "Manage everything from your account — skip a shipment, change your size, or cancel with one click.",
  },
];

export default function SubscriptionPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Subscription
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            A fresh pair, right when you need one.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted">
            Vokr Subscribe delivers a new pair every 3, 6, or 12 months at a
            discounted price — no need to remember to reorder.
          </p>
        </div>
      </section>

      {/* HOW SUBSCRIBE WORKS */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            How Subscribe works
          </h2>
          <ul className="space-y-6">
            {HOW_SUBSCRIBE_WORKS.map((item) => (
              <li key={item.step} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                  {item.step}
                </div>
                <div>
                  <h4 className="mb-1 text-base font-bold">{item.title}</h4>
                  <p className="text-sm text-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="bg-black px-5 py-16 text-center text-white sm:py-20">
        <div className="mx-auto max-w-xl">
          <h3 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
            Start your subscription.
          </h3>
          <p className="mb-7 text-[15px] text-white/70">
            Pick a style, choose your frequency, and never think about
            reordering again.
          </p>
          <Link
            href="/shop/model-x"
            className="inline-block bg-white px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-black hover:opacity-90"
          >
            Shop Model x &rarr;
          </Link>
        </div>
      </section>
    </>
  );
}
