import { createMetadata } from "@/lib/metadata";
import { WholesaleInquiryForm } from "./wholesale-inquiry-form";

/**
 * `wholesale-orders.html` — transcribed verbatim from the legacy
 * `.cp-hero` / `.cp-section` content between `</nav>` and
 * `<footer class="site-footer">`. Header/nav/cart/search/account/footer
 * markup is skipped — those are global (site-header.tsx / site-footer.tsx).
 */

export const metadata = createMetadata({
  title: "Wholesale Orders",
  alternates: { canonical: "/wholesale-orders" },
});

const PARTNERS = [
  {
    title: "Retail partners",
    body: "Boutiques and multi-brand stores looking to add a comfort-first footwear line.",
  },
  {
    title: "Corporate gifting",
    body: "Companies outfitting teams or client gift boxes with practical, well-made shoes.",
  },
  {
    title: "Hospitality & wellness",
    body: "Hotels, co-working spaces, and wellness brands offering Vokr as an in-house amenity.",
  },
];

export default function WholesaleOrdersPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
          Wholesale
        </p>
        <h1 className="mx-auto mb-4 max-w-2xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          Stock Vokr in your store.
        </h1>
        <p className="mx-auto max-w-xl text-[15px] text-muted">
          We partner with a select group of retailers, offices, and
          hospitality brands who want to offer their customers or teams a
          genuinely comfortable everyday shoe.
        </p>
      </section>

      {/* WHO WE WORK WITH */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Who we work with
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {PARTNERS.map((partner) => (
              <div key={partner.title}>
                <h4 className="mb-1.5 text-base font-bold">{partner.title}</h4>
                <p className="text-sm text-muted">{partner.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REQUEST WHOLESALE PRICING */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Request wholesale pricing
          </h2>
          <p className="mb-8 text-[15px] text-muted">
            Tell us a bit about your business and our partnerships team will
            follow up within 3 business days.
          </p>
          <WholesaleInquiryForm />
        </div>
      </section>
    </>
  );
}
