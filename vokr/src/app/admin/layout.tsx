import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireAdminPage } from "@/server/admin/page-guard";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Vokr admin" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <nav aria-label="Admin" className="mb-6 flex gap-4 border-b border-border pb-3 text-sm">
        <Link href="/admin/orders" className="underline">
          Orders
        </Link>
        <Link href="/admin/inventory" className="underline">
          Inventory
        </Link>
        <Link href="/admin/exceptions" className="underline">
          Exceptions
        </Link>
      </nav>
      {children}
    </div>
  );
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
