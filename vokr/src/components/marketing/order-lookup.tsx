"use client";

import { useState } from "react";

import { OrderReturns } from "@/components/marketing/order-returns";
import { OrderCard } from "@/components/orders/order-card";
import type { GuestOrderView } from "@/server/orders/lookup";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const RETURN_STATUSES = new Set(["delivered", "returned", "refunded"]);

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; order: GuestOrderView; credentials: { orderNumber: string; email: string } }
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
      if (response.ok && body.order) setState({ kind: "found", order: body.order, credentials: { orderNumber, email } });
      else setState({ kind: "error", message: body.error?.message ?? GENERIC_ERROR });
    } catch {
      setState({ kind: "error", message: GENERIC_ERROR });
    }
  }

  const order = state.kind === "found" ? state.order : null;
  // Returns exist only from delivery on (plan §5 Phase 10, task 7).
  const showReturns = state.kind === "found" && RETURN_STATUSES.has(state.order.status);

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
        {order && <OrderCard order={order} />}
      </div>
      {showReturns && state.kind === "found" ? (
        <OrderReturns key={state.order.orderNumber} orderNumber={state.credentials.orderNumber} email={state.credentials.email} />
      ) : null}
    </>
  );
}
