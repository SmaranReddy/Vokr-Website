import { Geist_Mono, Inter } from "next/font/google";
import { connection } from "next/server";
import "@/styles/globals.css";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CartProvider } from "@/components/cart/cart-provider";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/config/site";

// The legacy storefront (Vokr-Implementation-Plan.md §2A.1) sets Inter as
// its one typeface — matching it is part of Phase 4 task 2's "the visual
// result must match the legacy rendering" requirement.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = createMetadata({
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
});

/**
 * Every page renders per request: the enforced CSP carries a fresh nonce
 * (`src/proxy.ts`), and Next.js can only stamp it on its scripts while
 * rendering — a page prerendered at build time would ship un-nonced
 * scripts the browser then blocks.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-foreground focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-background"
        >
          Skip to content
        </a>
        <CartProvider>
          <SiteHeader />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
