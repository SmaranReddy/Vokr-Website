import { createMetadata } from "@/lib/metadata";
import { VerifyForm } from "./verify-form";

/**
 * `discount-program.html` — Vokr-Implementation-Plan.md §2A's approved
 * source of truth. Section order, headings and body copy below are
 * transcribed verbatim from the legacy file's `cp-hero` / `cp-section`
 * markup (header/nav/cart/search/account/footer are global and skipped).
 * The "Verify and get your code" form has no real ID-verification
 * backend yet, so its submit is left inert rather than faked — see the
 * `aria-disabled`/`title` on the button below.
 */

export const metadata = createMetadata({
  title: "Discount Program",
  alternates: { canonical: "/discount-program" },
});

const WHO_QUALIFIES = [
  {
    title: "Students",
    body: "Currently enrolled at a recognized college or university in India.",
  },
  {
    title: "Healthcare workers",
    body: "Nurses, doctors, and clinical staff working in hospitals or clinics.",
  },
  {
    title: "First responders",
    body: "Active police, fire, and emergency medical service personnel.",
  },
  {
    title: "Educators",
    body: "Teachers and school staff at any recognized educational institution.",
  },
];

export default function DiscountProgramPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Discount Program
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            A little extra comfort, for the people who&apos;ve earned it.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted">
            Vokr offers 15% off for students, healthcare workers, first
            responders, and educators — because some jobs (and some
            semesters) ask more of your feet than others.
          </p>
        </div>
      </section>

      {/* WHO QUALIFIES */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Who qualifies
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {WHO_QUALIFIES.map((item) => (
              <div key={item.title} className="rounded-2xl border border-border-strong p-6">
                <h4 className="mb-1.5 text-base font-bold">{item.title}</h4>
                <p className="text-sm text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VERIFY AND GET YOUR CODE */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Verify and get your code
          </h2>
          <p className="mb-8 text-[15px] text-muted">
            Verification takes about a minute through our partner ID
            verification service.
          </p>
          <VerifyForm />
        </div>
      </section>
    </>
  );
}
