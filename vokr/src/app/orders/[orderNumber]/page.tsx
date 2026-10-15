import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderDetail } from "@/components/orders/order-history";
import { ORDERING_ENABLED } from "@/config/commerce";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

/** One signed-in customer's order (plan §5 Phase 9, task 7). Not served while the storefront is browse-only. */
export default async function OrderPage({ params }: PageProps<"/orders/[orderNumber]">) {
  if (!ORDERING_ENABLED) notFound();
  const { orderNumber } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12">
      <p className="mb-4 text-sm">
        <Link href="/orders" className="text-muted underline underline-offset-4">
          ← Your orders
        </Link>
      </p>
      <OrderDetail orderNumber={orderNumber} />
    </main>
  );
}
