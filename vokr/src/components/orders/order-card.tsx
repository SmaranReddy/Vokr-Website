import { ORDER_STATUS_STEPS } from "@/config/support-content";
import { formatPaiseAsRupees } from "@/lib/currency";
import type { OrderView } from "@/server/orders/view";

/** Statuses on the four-step tracker, in order — `support-order-status.html`'s steps. */
const TRACKER = ["confirmed", "preparing", "shipped", "delivered"] as const;

/** Statuses that leave the tracker, with what the customer is told. */
export const OFF_TRACKER: Record<string, string> = {
  cancelled: "This order was cancelled.",
  refunded: "This order was refunded to your original payment method.",
  returned: "This order was returned.",
  rto: "This order couldn't be delivered and is on its way back to us.",
};

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** One order, as both guest lookup and signed-in history show it. */
export function OrderCard({ order }: { order: OrderView }) {
  const step = TRACKER.indexOf(order.status as (typeof TRACKER)[number]);
  return (
    <section aria-label={`Order ${order.orderNumber}`} className="mb-10 border border-border p-5">
      <p className="text-sm text-muted">
        Order <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span> · placed{" "}
        {formatOrderDate(order.placedAt)}
      </p>

      {step >= 0 ? (
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDER_STATUS_STEPS.map((tracker, index) => (
            <li
              key={tracker.title}
              aria-current={index === step ? "step" : undefined}
              className={`border-t-4 pt-2 text-sm ${index <= step ? "border-foreground font-semibold text-foreground" : "border-border text-muted"}`}
            >
              {tracker.title}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm font-semibold text-foreground">{OFF_TRACKER[order.status] ?? order.status}</p>
      )}

      <ul className="mt-5 space-y-1 text-sm">
        {order.items.map((item, index) => (
          <li key={index} className="flex justify-between gap-4">
            <span>
              {item.productName} · {item.sizeLabel} · Qty {item.quantity}
            </span>
            <span>{formatPaiseAsRupees(item.lineSubtotalPaise)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between border-t border-border pt-2 text-sm font-semibold">
        <span>Total</span>
        <span>{formatPaiseAsRupees(order.totalPaise)}</span>
      </p>
      <p className="mt-2 text-xs text-muted">
        Shipping to {order.shipTo.city}, {order.shipTo.state} {order.shipTo.pincode}
      </p>
    </section>
  );
}
