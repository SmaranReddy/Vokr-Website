import { redirect } from "next/navigation";

import { requireAdminPage } from "@/server/admin/page-guard";

export default async function AdminIndexPage() {
  await requireAdminPage();
  redirect("/admin/orders");
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
