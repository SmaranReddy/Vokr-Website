import Link from "next/link";

import { formatAdminDate, INPUT_CLASS, BUTTON_CLASS, TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/components/admin/format";
import { CheckoutPaymentMethod, OrderStatus } from "@/generated/prisma/enums";
import { formatPaiseAsRupees } from "@/lib/currency";
import { listAdminOrders, listOrdersQuerySchema } from "@/server/admin/orders";
import { requireAdminPage } from "@/server/admin/page-guard";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const raw = await searchParams;
  const input = {
    status: first(raw.status) || undefined,
    method: first(raw.method) || undefined,
    q: first(raw.q) || undefined,
    page: first(raw.page) || undefined,
  };
  const parsed = listOrdersQuerySchema.safeParse(input);
  const invalid = !parsed.success;
  const query = parsed.success ? parsed.data : listOrdersQuerySchema.parse({});
  const { rows, hasMore } = await listAdminOrders(query);

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.method) params.set("method", query.method);
    if (query.q) params.set("q", query.q);
    params.set("page", String(page));
    return `/admin/orders?${params.toString()}`;
  }

  return (
    <main>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Orders</h1>
      {invalid ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
          Those filters were not valid, so all orders are shown.
        </p>
      ) : null}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select name="status" defaultValue={query.status ?? ""} className={INPUT_CLASS}>
            <option value="">All</option>
            {Object.values(OrderStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Payment method
          <select name="method" defaultValue={query.method ?? ""} className={INPUT_CLASS}>
            <option value="">All</option>
            {Object.values(CheckoutPaymentMethod).map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Order number or PIN
          <input name="q" defaultValue={query.q ?? ""} maxLength={20} className={INPUT_CLASS} />
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Filter
        </button>
      </form>
      <p className="mb-4 text-sm">
        Shiprocket CSV export:{" "}
        <a href="/api/admin/exports/shiprocket?status=preparing" download className="underline">
          preparing orders
        </a>
        {" | "}
        <a href="/api/admin/exports/shiprocket?status=confirmed" download className="underline">
          confirmed orders
        </a>
      </p>
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th className={TH_CLASS}>Order</th>
              <th className={TH_CLASS}>Placed</th>
              <th className={TH_CLASS}>Status</th>
              <th className={TH_CLASS}>Method</th>
              <th className={TH_CLASS}>Items</th>
              <th className={TH_CLASS}>Total</th>
              <th className={TH_CLASS}>City / PIN</th>
              <th className={TH_CLASS}>AWB</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={TD_CLASS}>
                  No orders match.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.orderNumber}>
                  <td className={TD_CLASS}>
                    <Link href={`/admin/orders/${encodeURIComponent(row.orderNumber)}`} className="underline">
                      {row.orderNumber}
                    </Link>
                  </td>
                  <td className={TD_CLASS}>{formatAdminDate(row.placedAt)}</td>
                  <td className={TD_CLASS}>{row.status}</td>
                  <td className={TD_CLASS}>{row.paymentMethod}</td>
                  <td className={TD_CLASS}>{row.itemCount}</td>
                  <td className={TD_CLASS}>{formatPaiseAsRupees(row.totalPaise)}</td>
                  <td className={TD_CLASS}>
                    {row.shipCity} {row.shipPincode}
                  </td>
                  <td className={TD_CLASS}>{row.awb ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="mt-4 flex items-center gap-4 text-sm">
        {query.page > 1 ? (
          <Link href={pageHref(query.page - 1)} className="underline">
            Previous
          </Link>
        ) : null}
        <span>Page {query.page}</span>
        {hasMore ? (
          <Link href={pageHref(query.page + 1)} className="underline">
            Next
          </Link>
        ) : null}
      </nav>
    </main>
  );
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
