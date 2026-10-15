"use client";

import { useState } from "react";

import { ORDER_STATUS_STEPS } from "@/config/support-content";
import { formatPaiseAsRupees } from "@/lib/currency";
import type { GuestOrderView } from "@/server/orders/lookup";

/** Statuses on the four-step tracker, in order — `support-order-status.html`'s steps, now real. */
const TRACKER = ["confirmed", "preparing", "shipped", "delivered"] as const;

/** Statuses that leave the tracker, with what the customer is told. */
const OFF_TRACKER: Record<string, string> = {
  cancelled: "This order was cancelled.",
  refunded: "This order was refunded to your original payment method.",
  returned: "This order was returned.",
  rto: "This order couldn't be delivered and is on its way back to us.",
};

const GENERIC_ERROR = "Something went wrong. Please try again.";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; order: GuestOrderView }
  | { kind: "error"; message: string };

/**
 * The real Order Status form (plan §5 Phase 9, task 6): order number +
 * email, no login. Same fields, labels and button as the approved legacy
 * form; the server decides everything and answers every miss the same way.
 */
export function OrderLookup() {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNumber, email }),
      });
      const body = (await response.json()) as { order?: GuestOrderView; error?: { message?: string } };
      if (response.ok && body.order) setState({ kind: "found", order: body.order });
      else setState({ kind: "error", message: body.error?.message ?? GENERIC_ERROR });
    } catch {
      setState({ kind: "error", message: GENERIC_ERROR });
    }
  }

  const order = state.kind === "found" ? state.order : null;
  const step = order ? TRACKER.indexOf(order.status as (typeof TRACKER)[number]) : -1;

  return (
    <>
      <form onSubmit={onSubmit} className="mb-8 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="order-number" className="sr-only">
          Order number
        </label>
        <input
          id="order-number"
          type="text"
          required
          placeholder="Order number (e.g. VK-10234)"
          value={orderNumber}
          onChange={(event) => setOrderNumber(event.target.value)}
          className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <label htmlFor="order-email" className="sr-only">
          Email address
        </label>
        <input
          id="order-email"
          type="email"
          required
          placeholder="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={state.kind === "loading"}
          className="bg-foreground px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
        >
          {state.kind === "loading" ? "Checking…" : "Track Order"}
        </button>
      </form>

      <div role="status" aria-live="polite">
        {state.kind === "error" && <p className="mb-8 text-sm font-medium text-red-600">{state.message}</p>}
        {order && (
          <section aria-label={`Order ${order.orderNumber}`} className="mb-10 border border-border p-5">
            <p className="text-sm text-muted">
              Order <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span> · placed{" "}
              {new Date(order.placedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
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
        )}
      </div>
    </>
  );
}
