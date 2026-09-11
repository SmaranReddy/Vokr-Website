import Link from "next/link";
import { createMetadata } from "@/lib/metadata";
import { UploadForm } from "./upload-form";

/**
 * `analyze-your-shoes.html` — Vokr-Implementation-Plan.md §2A's approved
 * source of truth. Section order, headings and body copy below are
 * transcribed verbatim from the legacy file's `cp-hero` / `cp-section`
 * markup (header/nav/cart/search/account/footer are global and skipped).
 * The "Upload your shoes" form has no real image-analysis backend yet, so
 * its submit is left inert rather than faked — see the
 * `aria-disabled`/`title` on the button below. The file picker itself
 * stays fully usable; only the final submit action is inert.
 */

export const metadata = createMetadata({
  title: "Analyze Your Shoes",
  alternates: { canonical: "/analyze-your-shoes" },
});

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Upload a photo",
    body: "A clear top-down or side photo of your current everyday shoe works best.",
  },
  {
    step: "2",
    title: "Tell us the size on the box",
    body: "Whatever's printed on your current shoe's label — we'll convert it to Indian/UK sizing automatically.",
  },
  {
    step: "3",
    title: "Get your match",
    body: "We'll recommend the closest Vokr style and size, based on shape, width, and your current fit.",
  },
];

export default function AnalyzeYourShoesPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Analyze Your Shoes
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            Show us what you&apos;re wearing now. We&apos;ll tell you what
            fits better.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted">
            Upload a photo of your current everyday shoes and we&apos;ll
            recommend the closest Vokr match — plus a size suggestion based
            on your current pair.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <ul className="space-y-6">
            {HOW_IT_WORKS.map((item) => (
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

      {/* UPLOAD YOUR SHOES */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Upload your shoes
          </h2>
          <UploadForm />
          <p className="mt-3.5 text-xs text-muted-2">
            Prefer a guided quiz instead?{" "}
            <Link href="/#fit-quiz" className="font-semibold text-foreground underline underline-offset-2">
              Take the Find Your Fit quiz &rarr;
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
