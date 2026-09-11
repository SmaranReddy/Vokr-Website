import Link from "next/link";
import { Container } from "@/components/ui/container";
import { createMetadata } from "@/lib/metadata";
import { formatPaiseAsRupees } from "@/lib/currency";
import { listProducts } from "@/server/catalog";

export const metadata = createMetadata({ title: "Search" });

/**
 * The real destination for the header's search entry point (Phase 4
 * task 3). Not present as a standalone page in the legacy site — the
 * legacy implements search as a client-side overlay over a hardcoded
 * link list. This route queries the actual Phase 2 catalog instead,
 * which is the substance the legacy version only simulated.
 */
export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  const products = query ? await listProducts() : [];
  const results = query
    ? products.filter((product) =>
        product.name.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  return (
    <Container className="flex-1 py-16">
      <h1 className="mb-8 text-2xl font-bold tracking-tight">
        {query ? `Results for "${query}"` : "Search Vokr"}
      </h1>

      <form action="/search" method="get" className="mb-10 max-w-md">
        <label htmlFor="search-page-input" className="sr-only">
          Search Vokr
        </label>
        <input
          id="search-page-input"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search Vokr"
          className="w-full border-b-2 border-foreground bg-transparent py-2 text-xl font-semibold outline-none"
        />
      </form>

      {query && results.length === 0 && (
        <p className="text-sm text-muted">
          No results for <strong className="text-foreground">{query}</strong>.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        {results.map((product) => (
          <li key={product.id}>
            <Link href={`/shop/${product.slug}`} className="block">
              <div className="mb-2 aspect-square rounded-2xl bg-surface" />
              <p className="text-sm font-bold">{product.name}</p>
              <p className="text-sm text-muted">
                {formatPaiseAsRupees(product.variants[0]?.pricePaise ?? 0)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
