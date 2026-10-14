import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { ORDERING_ENABLED } from "@/config/commerce";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

/**
 * Storefront-only launch gate (§2A.6 row L1): the checkout API refuses
 * every request while ordering is disabled, so the page that drives it is
 * not served either — no reachable form that can only ever fail.
 */
export default function CheckoutPage() {
  if (!ORDERING_ENABLED) notFound();
  return <CheckoutFlow />;
}
