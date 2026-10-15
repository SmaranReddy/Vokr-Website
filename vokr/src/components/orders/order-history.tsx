"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatPaiseAsRupees } from "@/lib/currency";
import type { OrderSummary } from "@/server/orders/history";
import type { OrderView } from "@/server/orders/view";

import { formatOrderDate, OrderCard } from "./order-card";

const GENERIC_ERROR = "We couldn't load your orders. Please try again.";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Order confirmed",
  preparing: "Preparing to ship",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  returned: "Returned",
  rto: "Returning to us",
};

function SignInPrompt({ what }: { what: string }) {
  return (
    <p className="text-sm text-muted">
      <Link href="/sign-in" className="font-semibold text-foreground underline underline-offset-4">
        Sign in
      </Link>{" "}
      to see {what}. Ordered as a guest? Use{" "}
      <Link href="/support-order-status" className="font-semibold text-foreground underline underline-offset-4">
        Order Status
      </Link>{" "}
      with your order number and email.
    </p>
  );
}

type ListState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string }
  | { kind: "ready"; orders: OrderSummary[]; nextBefore: string | null; loadingMore: boolean };

/** The signed-in customer's orders, newest first (plan §5 Phase 9, task 7). */
export function OrderHistory() {
  const [state, setState] = useState<ListState>({ kind: "loading" });

  const load = useCallback(async (before?: string) => {
    const response = await fetch(`/api/orders${before ? `?before=${encodeURIComponent(before)}` : ""}`, {
      cache: "no-store",
    });
    if (response.status === 401) return { kind: "signed_out" } as const;
    if (!response.ok) throw new Error(GENERIC_ERROR);
    return (await response.json()) as { orders: OrderSummary[]; nextBefore: string | null };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (cancelled) return;
        if ("kind" in result) setState(result);
        else setState({ kind: "ready", ...result, loadingMore: false });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: GENERIC_ERROR }));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (state.kind !== "ready" || !state.nextBefore) return;
    setState({ ...state, loadingMore: true });
    try {
      const result = await load(state.nextBefore);
      if ("kind" in result) return setState(result);
      setState({ kind: "ready", orders: [...state.orders, ...result.orders], nextBefore: result.nextBefore, loadingMore: false });
    } catch {
      setState({ ...state, loadingMore: false });
    }
  }

  if (state.kind === "loading") return <p className="text-sm text-muted">Loading your orders…</p>;
  if (state.kind === "signed_out") return <SignInPrompt what="your orders" />;
  if (state.kind === "error") return <p role="alert" className="text-sm font-medium text-red-600">{state.message}</p>;
  if (state.orders.length === 0) {
    return (
      <p className="text-sm text-muted">
        You haven&apos;t placed any orders yet.{" "}
        <Link href="/" className="font-semibold text-foreground underline underline-offset-4">
          Browse the collection
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border border-y border-border">
        {state.orders.map((order) => (
          <li key={order.orderNumber}>
            <Link
              href={`/orders/${order.orderNumber}`}
              className="flex flex-wrap items-center justify-between gap-2 py-4 text-sm hover:bg-foreground/5"
            >
              <span>
                <span className="font-mono font-semibold">{order.orderNumber}</span>
                <span className="ml-3 text-muted">{formatOrderDate(order.placedAt)}</span>
              </span>
              <span className="text-muted">
                {order.itemCount} {order.itemCount === 1 ? "item" : "items"} · {formatPaiseAsRupees(order.totalPaise)}
              </span>
              <span className="font-medium">{STATUS_LABEL[order.status] ?? order.status}</span>
            </Link>
          </li>
        ))}
      </ul>
      {state.nextBefore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={state.loadingMore}
          className="mt-6 border border-foreground px-6 py-3 text-sm font-semibold disabled:opacity-50"
        >
          {state.loadingMore ? "Loading…" : "Show older orders"}
        </button>
      )}
    </>
  );
}

type DetailState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; order: OrderView };

/** One of the signed-in customer's orders; anyone else's is "not found". */
export function OrderDetail({ orderNumber }: { orderNumber: string }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) return setState({ kind: "signed_out" });
        if (response.status === 404) return setState({ kind: "not_found" });
        if (!response.ok) return setState({ kind: "error" });
        setState({ kind: "ready", order: ((await response.json()) as { order: OrderView }).order });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  if (state.kind === "loading") return <p className="text-sm text-muted">Loading order…</p>;
  if (state.kind === "signed_out") return <SignInPrompt what="this order" />;
  if (state.kind === "not_found") {
    return (
      <p className="text-sm text-muted">
        We couldn&apos;t find that order on your account.{" "}
        <Link href="/orders" className="font-semibold text-foreground underline underline-offset-4">
          See all your orders
        </Link>
        .
      </p>
    );
  }
  if (state.kind === "error") return <p role="alert" className="text-sm font-medium text-red-600">{GENERIC_ERROR}</p>;
  return (
    <>
      <OrderCard order={state.order} />
      <p className="text-xs text-muted">
        Questions about this order?{" "}
        <Link href="/support-contact" className="underline underline-offset-4">
          Contact us
        </Link>
        .
      </p>
    </>
  );
}
