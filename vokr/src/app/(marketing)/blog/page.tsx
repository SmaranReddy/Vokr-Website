import Link from "next/link";
import { createMetadata } from "@/lib/metadata";

/**
 * `blog.html` — transcribed verbatim from the legacy `.cp-hero` /
 * `.cp-section` / `.cp-cta-band` content between `</nav>` and
 * `<footer class="site-footer">`. Header/nav/cart/search/account/footer
 * markup is skipped — those are global (site-header.tsx / site-footer.tsx).
 */

export const metadata = createMetadata({
  title: "Blog",
  alternates: { canonical: "/blog" },
});

const POSTS = [
  {
    tag: "Materials",
    title: 'Why copper, and not just "antimicrobial spray"',
    body: "A look at why we chose copper-infused lining over the coatings most shoe brands use — and what the difference actually feels like after six months.",
  },
  {
    tag: "Sizing",
    title: "Why we only use Indian/UK sizing",
    body: "US and EU sizing charts confuse more customers than they help. Here's why every Vokr shoe ships in straightforward IN/UK sizes.",
  },
  {
    tag: "Company",
    title: "How Model x went from sketch to shelf",
    body: "Eighteen months, four prototype rounds, and one very stubborn opinion about laces — the story of our first shoe.",
  },
  {
    tag: "Care",
    title: "How to actually make your shoes last two years",
    body: "Simple habits — most of them under two minutes — that meaningfully extend the life of any pair of sneakers, Vokr or otherwise.",
  },
  {
    tag: "Community",
    title: "What 250,000 pairs of feet taught us about fit",
    body: "Patterns we noticed across thousands of customer fit-quiz responses, and how they shaped Model 001.",
  },
  {
    tag: "Sustainability",
    title: 'What "recycled materials" actually means at Vokr',
    body: "A transparent breakdown of exactly which components in our shoes are recycled, and which aren't yet.",
  },
];

export default function BlogPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
          Blog
        </p>
        <h1 className="mx-auto mb-4 max-w-2xl text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          Notes on comfort, materials, and moving through your day.
        </h1>
        <p className="mx-auto max-w-xl text-[15px] text-muted">
          Occasional writing from the Vokr team — on what we&apos;re
          building, what we&apos;re learning, and what a genuinely
          comfortable shoe should feel like.
        </p>
      </section>

      {/* LATEST POSTS */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Latest posts
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {POSTS.map((post) => (
              <div key={post.title} className="border border-border-strong p-6">
                <span className="mb-3 inline-block text-[11px] font-semibold tracking-[.1em] text-muted uppercase">
                  {post.tag}
                </span>
                <h4 className="mb-2 text-base font-bold">{post.title}</h4>
                <p className="mb-4 text-sm text-muted">{post.body}</p>
                <a href="#" className="text-[13px] font-semibold underline underline-offset-2">
                  Read more &rarr;
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="bg-surface-2 px-5 py-16 text-center sm:py-20">
        <h3 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
          New posts, straight to your inbox.
        </h3>
        <p className="mb-6 text-[15px] text-muted">
          No spam — just the occasional story worth reading.
        </p>
        <Link href="/#signup" className="text-sm font-semibold underline underline-offset-2">
          Subscribe &rarr;
        </Link>
      </section>
    </>
  );
}
