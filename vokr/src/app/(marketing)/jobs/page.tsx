import { createMetadata } from "@/lib/metadata";

/**
 * `jobs.html` — transcribed verbatim from the legacy `.cp-hero` /
 * `.cp-section` / `.cp-cta-band` content between `</nav>` and
 * `<footer class="site-footer">`. Header/nav/cart/search/account/footer
 * markup is skipped — those are global (site-header.tsx / site-footer.tsx).
 * The `careers@vokr.shop` mailto address is preserved exactly as the
 * legacy markup has it.
 */

export const metadata = createMetadata({
  title: "Jobs",
  alternates: { canonical: "/jobs" },
});

const LIFE_AT_VOKR = [
  {
    title: "Small team, real ownership",
    body: "No layers of approval. If you're closest to a decision, you make it.",
  },
  {
    title: "Remote-friendly",
    body: "Most roles can be done from anywhere in India, with quarterly in-person team weeks in Bengaluru.",
  },
  {
    title: "We wear what we make",
    body: "Every team member gets Vokr shoes on day one — and honest feedback is part of the job.",
  },
];

const OPEN_ROLES = [
  {
    title: "Senior Product Designer, Footwear",
    meta: "Bengaluru · Full-time · Design new silhouettes and iterate on existing ones with our material science team.",
  },
  {
    title: "Supply Chain Manager",
    meta: "Bengaluru · Full-time · Own sourcing and manufacturing relationships across our production partners.",
  },
  {
    title: "Customer Experience Associate",
    meta: "Remote (India) · Full-time · Be the first voice customers hear when something goes right — or wrong.",
  },
  {
    title: "Performance Marketing Lead",
    meta: "Remote (India) · Full-time · Own paid acquisition across Meta, Google, and emerging channels.",
  },
];

export default function JobsPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
          Jobs
        </p>
        <h1 className="mx-auto mb-4 max-w-2xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          Help us build shoes people actually wear every day.
        </h1>
        <p className="mx-auto max-w-xl text-[15px] text-muted">
          We&apos;re a small, remote-friendly team based out of Bengaluru. We
          hire slowly, care a lot about craft, and give people real
          ownership over what they build.
        </p>
      </section>

      {/* LIFE AT VOKR */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Life at Vokr
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {LIFE_AT_VOKR.map((item) => (
              <div key={item.title}>
                <h4 className="mb-1.5 text-base font-bold">{item.title}</h4>
                <p className="text-sm text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* OPEN ROLES */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Open roles
          </h2>
          <p className="mb-8 text-[15px] text-muted">
            Don&apos;t see a fit? Email us at{" "}
            <a
              href="mailto:careers@vokr.shop"
              className="font-semibold text-foreground underline underline-offset-2"
            >
              careers@vokr.shop
            </a>{" "}
            anyway — we read everything.
          </p>
          <ul>
            {OPEN_ROLES.map((role) => (
              <li
                key={role.title}
                className="flex items-start gap-4 border-b border-border py-5 first:border-t"
              >
                <div className="text-2xl" aria-hidden="true">
                  &#128188;
                </div>
                <div className="flex-1">
                  <h4 className="mb-1 text-base font-bold">{role.title}</h4>
                  <p className="text-sm text-muted">{role.meta}</p>
                </div>
                <div className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
                  Apply &rarr;
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h3 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
          Don&apos;t see the right role?
        </h3>
        <p className="mb-6 text-[15px] text-muted">
          We&apos;re always open to hearing from people who care about craft
          and comfort.
        </p>
        <a href="mailto:careers@vokr.shop" className="text-sm font-semibold underline underline-offset-2">
          Email Careers &rarr;
        </a>
      </section>
    </>
  );
}
