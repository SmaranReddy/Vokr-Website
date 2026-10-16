import { AdjustStockForm } from "@/components/admin/adjust-stock-form";
import { TABLE_CLASS, TD_CLASS, TH_CLASS } from "@/components/admin/format";
import { listStock } from "@/server/admin/inventory";
import { requireAdminPage } from "@/server/admin/page-guard";

export default async function AdminInventoryPage() {
  await requireAdminPage();
  const rows = await listStock();
  return (
    <main>
      <h1 className="mb-2 text-xl font-semibold text-foreground">Inventory</h1>
      <p className="mb-4 text-sm text-muted">
        Adjustments require a reason and are audited. Refunds never restock: add units back here after a cancellation,
        RTO or return.
      </p>
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th className={TH_CLASS}>Product</th>
              <th className={TH_CLASS}>SKU</th>
              <th className={TH_CLASS}>Size</th>
              <th className={TH_CLASS}>Colour</th>
              <th className={TH_CLASS}>Variant status</th>
              <th className={TH_CLASS}>On hand</th>
              <th className={TH_CLASS}>Reserved</th>
              <th className={TH_CLASS}>Available</th>
              <th className={TH_CLASS}>Adjust</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={TD_CLASS}>
                  None
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.variantId}>
                  <td className={TD_CLASS}>{row.productName}</td>
                  <td className={TD_CLASS}>{row.sku}</td>
                  <td className={TD_CLASS}>{row.sizeLabel}</td>
                  <td className={TD_CLASS}>{row.colorway}</td>
                  <td className={TD_CLASS}>{row.variantStatus}</td>
                  <td className={TD_CLASS}>{row.quantityOnHand}</td>
                  <td className={TD_CLASS}>{row.quantityReserved}</td>
                  <td className={TD_CLASS}>{row.quantityOnHand - row.quantityReserved}</td>
                  <td className={TD_CLASS}>
                    <AdjustStockForm variantId={row.variantId} sku={row.sku} onHand={row.quantityOnHand} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// Reads the session via the admin guard: never prerender.
export const dynamic = "force-dynamic";
