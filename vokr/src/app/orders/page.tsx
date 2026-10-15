import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderHistory } from "@/components/orders/order-history";
import { ORDERING_ENABLED } from "@/config/commerce";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

/** Signed-in order history (plan §5 Phase 9, task 7). Not served while the storefront is browse-only. */
export default function OrdersPage() {
  if (!ORDERING_ENABLED) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <h1 className="mb-6 text-xl font-semibold text-foreground">Your orders</h1>
      <OrderHistory />
    </main>
  );
}
