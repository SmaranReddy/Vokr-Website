import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createMetadata } from "@/lib/metadata";
import { formatPaiseAsRupees } from "@/lib/currency";
import { NotFoundError } from "@/lib/errors";
import { getProductBySlug, listProducts } from "@/server/catalog";
import { PDP_CONTENT } from "@/config/pdp-content";
import { PdpPurchasePanel } from "@/components/shop/pdp-purchase-panel";
import { ReviewsSummary } from "@/components/shop/reviews-summary";

/**
 * The single dynamic PDP template that replaces the five near-identical
 * `shop-*.html` files (Phase 4 task 5, §2A.6-approved as
 * implementation-only). Layout, section order and copy blocks reproduce
 * `.pdp-section` / `.rr-section` exactly; price, sizes and stock come
 * live from the Phase 2 catalog rather than being hardcoded per page.
 */

/**
 * Pre-populates the 5 launch slugs at build time when the database is
 * reachable. Falls back to an empty list — not a build failure — when it
 * isn't: `dynamicParams` defaults to `true`, so every slug still renders
 * correctly on first request, on demand. A transient build-time DB hiccup
 * has no business taking every other already-built page down with it.
 */
export async function generateStaticParams() {
  try {
    const products = await listProducts();
    return products.map((product) => ({ slug: product.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/shop/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await getProductBySlug(slug);
    return createMetadata({
      title: product.name,
      description: product.description,
      alternates: { canonical: `/shop/${product.slug}` },
      openGraph: { title: product.name, description: product.description },
    });
  } catch {
    return createMetadata({ title: "Product" });
  }
}

export default async function ProductPage({
  params,
}: PageProps<"/shop/[slug]">) {
  const { slug } = await params;

  let product;
  try {
    product = await getProductBySlug(slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const content = PDP_CONTENT[product.slug];
  if (!content) notFound();

  const displayPrice =
    product.variants.find((variant) => variant.isPurchasable)?.pricePaise ??
    product.variants[0]?.pricePaise ??
    0;

  return (
    <>
      <section className="px-5 py-12 sm:py-16">
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-15">
          <div className="aspect-square overflow-hidden rounded-2xl bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- legacy CDN asset, migrated as-is until Phase 14 (R21). */}
            <img
              src={content.heroImage}
              alt={content.heroAlt}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight">
              {product.name}
            </h1>
            <p className="mb-4 text-xl font-semibold">
              {formatPaiseAsRupees(displayPrice)}
            </p>
            <p className="mb-8 text-[15px] leading-relaxed text-foreground/75">
              {content.description}
            </p>

            <PdpPurchasePanel variants={product.variants} />

            <ul className="mt-8 space-y-2 border-t border-border pt-6 text-sm text-foreground/80">
              {content.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <ReviewsSummary />
    </>
  );
}
