import { createMetadata } from "@/lib/metadata";
import { AmbassadorApplyForm } from "./ambassador-apply-form";

/**
 * `vokr-ambassadors.html` — transcribed verbatim from the legacy
 * `.cp-hero` / `.cp-section` content between `</nav>` and
 * `<footer class="site-footer">`. Header/nav/cart/search/account/footer
 * markup is skipped — those are global (site-header.tsx / site-footer.tsx).
 */

export const metadata = createMetadata({
  title: "Vokr Ambassadors",
  alternates: { canonical: "/vokr-ambassadors" },
});

const PERKS = [
  {
    title: "Free pairs, first",
    body: "New styles and colorways land in your hands before they're publicly announced.",
  },
  {
    title: "Commission on referrals",
    body: "Earn a percentage of every sale that comes through your unique referral link.",
  },
  {
    title: "Direct line to the team",
    body: "Monthly calls with our product team — your feedback genuinely shapes the roadmap.",
  },
];

export default function VokrAmbassadorsPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
          Vokr Ambassadors
        </p>
        <h1 className="mx-auto mb-4 max-w-2xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          Already telling people about your Vokr shoes? Let&apos;s make it
          official.
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-[15px] text-muted">
          The Vokr Ambassador program is for customers, creators, and
          community members who want early access, exclusive perks, and a
          real say in what we build next.
        </p>
        <a
          href="#ambassador-apply"
          className="inline-block bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background hover:opacity-90"
        >
          Apply Now &rarr;
        </a>
      </section>

      {/* WHAT AMBASSADORS GET */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            What Ambassadors get
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {PERKS.map((perk) => (
              <div key={perk.title}>
                <h4 className="mb-1.5 text-base font-bold">{perk.title}</h4>
                <p className="text-sm text-muted">{perk.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* APPLY */}
      <section id="ambassador-apply" className="scroll-mt-16 border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Apply to become an Ambassador
          </h2>
          <p className="mb-8 text-[15px] text-muted">
            Takes about two minutes. We review applications every two weeks.
          </p>
          <AmbassadorApplyForm />
        </div>
      </section>
    </>
  );
}
