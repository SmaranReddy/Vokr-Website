import Link from "next/link";
import { ResponsiveImage } from "@/components/ui/responsive-image";
import { createMetadata } from "@/lib/metadata";
import { Accordion, type AccordionItemData } from "@/components/marketing/accordion";
import { FitQuizModal } from "@/components/marketing/fit-quiz-modal";
import { SupportGroup } from "@/components/marketing/support-group";

/**
 * The Vokr homepage — Vokr-Implementation-Plan.md §2A.1's approved
 * source of truth. Section order, headings and body copy below are
 * transcribed verbatim from `index (7).html` / the tracked
 * `vokr-production/index.html` (the two agree on every point except the
 * two CSS values §2A.8 records — neither affects this file). Every
 * `<section>` below corresponds 1:1 to a legacy `<section>` of the same
 * name, in the same order, for the §2A.7 structural diff.
 */

export const metadata = createMetadata({
  alternates: { canonical: "/" },
});

const COMFORT_ITEMS: AccordionItemData[] = [
  {
    id: "comfort-formula",
    label: "Our Comfort Formula",
    content:
      "A lightweight foam midsole and a soft, snug knit upper work together so the shoe moves the way your foot does — through long days on your feet, quick errands, and everything in between.",
  },
  {
    id: "premium-materials",
    label: "Premium Materials",
    content:
      "Recycled knit uppers, natural rubber outsoles, and a cushioned sockliner. We choose materials for how they feel on day one and day three hundred.",
  },
  {
    id: "no-bad-odors",
    label: "No Bad Odors",
    content:
      "A copper-infused antimicrobial lining keeps odor-causing bacteria from building up, so your shoes stay fresh even after back-to-back wears.",
  },
  {
    id: "eco-friendly",
    label: "Eco-Friendly",
    content:
      "We build with recycled and low-impact materials wherever we can, and design every pair to last long enough that you're not replacing it every season.",
  },
  {
    id: "slip-on-off",
    label: "Slip On/Off With Ease",
    content:
      "Stretch laces mean you tie them once and never again — just slip in and go, whether you're rushing out the door or heading through security.",
  },
  {
    id: "easy-to-clean",
    label: "Easy To Clean",
    content:
      "A damp cloth and a few minutes is usually all it takes. For a deeper clean, the knit upper and laces are machine-washable on a gentle cycle.",
  },
];

// `.tech-card` — each card leads with a material close-up. The legacy's
// second card genuinely reuses the antimicrobial-lining photograph under a
// different alt; that pairing is reproduced rather than corrected, since
// which image sits where is approved content (§2A.4), not an engineering
// choice (R21/Phase 14 changes only how these are delivered).
const TECH_CARDS = [
  {
    title: "Antimicrobial Lining",
    body: "Vokr shoes feature an antimicrobial copper lining that kills bacteria and prevents odor.",
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/Antimicrobial_lining.jpg?v=1777482622",
    alt: "Antimicrobial copper lining close-up",
  },
  {
    title: "Lightweight Foam",
    body: "A lightweight foam midsole cushions your feet for unparalleled comfort.",
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/Antimicrobial_lining.jpg?v=1777482622",
    // D7: configured, this slot shows index (7).html's outsole photograph
    // (DOM #8) — which its alt describes — instead of a second copy of the lining.
    imageId: "outsole-detail" as const,
    alt: "Vokr outsole detail close-up",
  },
  {
    title: "Stretch Laces",
    body: "Stretch laces, so you only have to tie your shoes once.",
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/LACES2.jpg?v=1777579071",
    alt: "Stretch laces close-up",
  },
];

// `.ig-grid` tiles. The legacy overlaid each with a customer-style
// Instagram handle and closed with a "Follow @vokr" link to "#"; the
// handles were unverifiable social proof and no real account is published,
// so both were removed under §2A.6 row L1. The photographs are Vokr's own
// product shots, so the alt text now says what they are.
const INSTAGRAM_TILES = [
  {
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
    alt: "Vokr Model x — White/Black, side view",
  },
  {
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
    alt: "Vokr Model 001 — Black, side view",
  },
  {
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772",
    alt: "Vokr shoe — White, side view",
  },
  {
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
    alt: "Vokr Model x — White/Black, side view",
  },
  {
    img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
    alt: "Vokr Model 001 — Black, side view",
  },
];

export default function Home() {
  return (
    <>
      {/* HERO */}
      {/* Legacy `.hero` puts the image *above* the text below 901px
          (`.hero-img { order: 1 }` / `.hero-text { order: 2 }`) — the
          migrated markup keeps source order for reading order and swaps
          visually, matching the approved page. */}
      <section className="grid grid-cols-1 wide:grid-cols-2">
        <div className="order-2 flex flex-col justify-start gap-5 px-6 py-12 wide:order-1 wide:justify-end wide:px-12 wide:py-16">
          <p className="text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Introducing
          </p>
          <h1 className="text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            Model x :<br />
            White &amp; Black
          </h1>
          <p className="max-w-xs text-[15px] text-muted">
            The White &amp; Black. Online ordering isn&apos;t open yet.
          </p>
          <Link
            href="/shop/model-x"
            className="inline-block w-fit bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background hover:opacity-90"
          >
            Shop Model x &rarr;
          </Link>
        </div>
        <div className="order-1 min-h-[300px] bg-surface-2 wide:order-2 wide:min-h-0">
          {/* D7: the configured image is index (7).html's overhead photograph, which this alt already describes. */}
          <ResponsiveImage
            id="model-x-white-overhead"
            legacySrc="https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639"
            alt="Vokr Model x — White overhead pair view"
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-full w-full object-cover"
            priority
          />
        </div>
      </section>

      {/* FEATURE STRIP */}
      <div className="grid grid-cols-2 border-y border-border wide:grid-cols-4">
        {[
          { label: "Cushioning", value: "All Day Comfort" },
          { label: "Antimicrobial lining", value: "Copper-Infused" },
          { label: "Stretch laces", value: "Slip-On" },
          { label: "Heel to Toe Drop", value: "8mm" },
        ].map((feat) => (
          <div
            key={feat.label}
            className="flex flex-col items-center gap-1.5 border-r border-border px-4 py-6 text-center last:border-r-0"
          >
            <span className="text-[11px] font-semibold tracking-[.1em] text-muted uppercase">
              {feat.label}
              <sup className="text-[10px] text-subtle not-italic">i</sup>
            </span>
            <span className="text-[13px] font-bold">{feat.value}</span>
          </div>
        ))}
      </div>

      {/* EXPLORE EVERY DAY */}
      <section className="grid grid-cols-1 border-t border-border wide:grid-cols-2">
        <div className="min-h-[280px] bg-surface-2 wide:min-h-[500px]">
          {/* D7: as the hero. */}
          <ResponsiveImage
            id="model-x-black-overhead"
            legacySrc="https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772"
            alt="Vokr Model x — Black overhead pair view"
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col justify-center px-6 py-10 wide:px-12 wide:py-14">
          <div className="mb-8 flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
              Explore Every Day
            </span>
            <Link href="/shop/model-x" className="text-[13px] font-semibold underline underline-offset-2">
              Shop All Shoes &rarr;
            </Link>
          </div>
          <h2 className="mb-4 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            Work. Fun. Daily Sprints. All in the same shoes.
          </h2>
          <p className="mb-7 max-w-md text-[15px] leading-relaxed text-muted">
            Vokr shoes are versatile, durable and super supportive.
            They&apos;re your perfect pair for hectic days, last-minute
            flights, and relaxing walks.
          </p>
          <Link
            href="/#fit-quiz"
            className="inline-block w-fit bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background hover:opacity-90"
          >
            Find Your Fit
          </Link>
        </div>
      </section>

      {/* TESTIMONIALS — removed under §2A.6 row L1: the "250,000+
          customers" figure and six attributed quotes (named people at real
          companies, with social handles) could not be substantiated. */}

      {/* ACCORDION — Everything that makes Vokr, Vokr */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything that makes Vokr, Vokr.
          </h2>
          <Accordion items={COMFORT_ITEMS} defaultOpenId="comfort-formula" />
        </div>
      </section>

      {/* FIND YOUR FIT — sizing quiz launcher */}
      <section id="fit-quiz" className="scroll-mt-16 bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h2 className="mx-auto mb-3 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
          Find your size. Find the pair made for you.
        </h2>
        <p className="mb-8 text-[15px] text-muted">
          Five questions. One pair that fits how you actually live.
        </p>
        <FitQuizModal />
      </section>

      {/* PICKED FOR YOU */}
      <section className="px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <h2 className="mb-1 text-3xl font-bold tracking-tight sm:text-4xl">
                Picked for you
              </h2>
              <p className="text-[15px] text-muted">
                Experience the ultimate comfort and style.
              </p>
            </div>
            <Link href="/shop/model-x" className="text-[13px] font-semibold underline underline-offset-2">
              Shop All Shoes &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-8 wide:grid-cols-3">
            {[
              {
                href: "/shop/model-x",
                img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
                alt: "Vokr Model x — White/Black",
                name: "Model x — White/Black",
                desc: "The original. One silhouette for every surface.",
              },
              {
                href: "/shop/model-001",
                img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
                alt: "Vokr Model 001 — Black",
                name: "Model 001 — Black",
                desc: "All-black. Every road. No ceremony.",
              },
              {
                href: "/shop/kids-model-123",
                img: "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772",
                alt: "Vokr Kids Model abc — White",
                name: "Kids Model abc",
                desc: "Same philosophy. Smaller feet.",
              },
            ].map((product) => (
              <div key={product.href}>
                <Link href={product.href} className="mb-3 block aspect-square overflow-hidden rounded-2xl bg-surface-2">
                  <ResponsiveImage legacySrc={product.img} alt={product.alt} sizes="(min-width: 1024px) 33vw, 100vw" className="h-full w-full object-cover" />
                </Link>
                <p className="mb-1 text-sm font-bold">{product.name}</p>
                <p className="mb-3 text-sm text-muted">{product.desc}</p>
                {/* D6 (12 Sep 2026) made this control navigate to its PDP.
                    §2A.6 row L1 relabels it from the legacy "Add to Cart":
                    ordering is not available, so a purchase verb here would
                    imply something the storefront cannot do. */}
                <Link
                  href={product.href}
                  className="inline-block border border-border-strong px-5 py-2.5 text-[13px] font-semibold hover:border-foreground"
                >
                  View Details
                  <span className="sr-only">
                    {" — "}
                    {product.name}
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TECHNOLOGY */}
      <section className="bg-surface-2 px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <p className="mb-2 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Technology
          </p>
          <h2 className="mb-10 max-w-lg text-3xl font-bold tracking-tight sm:text-4xl">
            Every millimetre. Every material. Every detail.
          </h2>
          <div className="grid grid-cols-1 gap-8 wide:grid-cols-3">
            {TECH_CARDS.map((card) => (
              <div key={card.title}>
                <div className="mb-4 aspect-square overflow-hidden rounded-2xl bg-border">
                  <ResponsiveImage
                    id={card.imageId}
                    legacySrc={card.img}
                    alt={card.alt}
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="h-full w-full object-cover"
                  />
                </div>
                <h3 className="mb-1.5 text-base font-bold">{card.title}</h3>
                <p className="text-sm text-muted">{card.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center">
            <Link href="/technology" className="text-sm font-semibold underline underline-offset-2">
              Learn More
            </Link>
          </p>
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl space-y-8 text-lg leading-relaxed sm:text-xl">
          <p>
            <strong>Somewhere along the way, more became the point.</strong>{" "}
            More options, more colorways, more drops, more collections — more
            shoes for more occasions for a life that was already moving too
            fast to notice any of them.
          </p>
          <p>
            We don&apos;t think that&apos;s freedom. We think that&apos;s
            noise dressed up as choice.{" "}
            <strong>
              Real freedom is knowing exactly what you need and having
              exactly that.
            </strong>{" "}
            Nothing waiting to be decided. Nothing crowding the floor of your
            entryway.
          </p>
          <p>
            <strong>
              VOKR was built for the people who&apos;ve already figured this
              out
            </strong>{" "}
            — or are in the process of figuring it out. The ones who want to
            move through cities, terrain, and time without friction, without
            ceremony, without eight decisions before they reach the door.
          </p>
          <p>
            We make one shoe. <strong>Not one type of shoe. One shoe.</strong>{" "}
            Every version of your day — the pavement, the path, the
            impromptu mile at 11pm, the airport terminal, the meeting, the
            mountain — was considered in its design. We didn&apos;t create a
            versatile shoe. We created the only shoe.
          </p>
          <div className="pt-8 text-center">
            <p className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Wear less.
              <br />
              Live more.
            </p>
            <p className="text-sm text-muted">VOKR — One Shoe. Every Road.</p>
          </div>
        </div>
      </section>

      {/* BRAND STORY */}
      <section className="grid grid-cols-1 gap-10 border-t border-border px-5 py-16 wide:grid-cols-2 wide:py-20">
        <div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            One shoe.
            <br />
            <em className="font-normal italic">Not one type</em>
            <br />
            of shoe.
          </h2>
        </div>
        <div>
          <p className="mb-6 text-lg leading-relaxed font-medium">
            We started with a problem we couldn&apos;t stop thinking about:
            why do people who own fifty shoes still feel like they have
            nothing to wear?
          </p>
          <div className="space-y-4 text-[15px] leading-relaxed text-foreground/80">
            <p>
              <strong>The answer wasn&apos;t more shoes.</strong> It was one
              shoe, considered so deeply that the question never comes up
              again.
            </p>
            <p>
              <strong>Every material, every stitch</strong> was chosen not
              for trend but for the actual demands of a day spent on the
              move.
            </p>
            <p>
              <strong>No celebrity endorsements</strong> at launch. No
              billboard campaigns. Just a shoe quietly passed between people
              who recognized what it was.
            </p>
            <p>
              <strong>We remain a small team</strong> by choice. Slower. More
              deliberate. Making one thing well.
            </p>
            <p className="pt-2 text-sm font-semibold">
              VOKR — Founded on the belief that enough is more than enough.
            </p>
          </div>
        </div>
      </section>

      {/* INSTAGRAM */}
      <section className="px-5 py-16 sm:py-20">
        <p className="mb-6 text-center text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
          Vokr in everyday
        </p>
        {/* `.ig-grid` is five 2/3-portrait tiles across at ≥901px, three at
            541–900px and two at ≤540px — the legacy hides the overflow
            (`.ig-item:nth-child(n+4)` / `(n+3)`) rather than wrapping it,
            so the strip is always exactly one row. */}
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-[3px] narrow:grid-cols-3 wide:grid-cols-5">
          {INSTAGRAM_TILES.map((item, index) => (
            <div
              key={index}
              className={`relative aspect-2/3 overflow-hidden bg-surface-2 ${
                index >= 3 ? "hidden wide:block" : index >= 2 ? "hidden narrow:block" : ""
              }`}
            >
              <ResponsiveImage legacySrc={item.img} alt={item.alt} sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      </section>

      {/* PRESS — removed under §2A.6 row L1: an unattributed quote beside
          three outlet names, with no citation to substantiate it. */}

      {/* SUPPORT (collapsed group — linked from hamburger "Support" section) */}
      <SupportGroup />
    </>
  );
}
