"use client";

import { useEffect, useState, type FormEvent } from "react";

import { formatOrderDate } from "@/components/orders/order-card";
import type { CustomerReturnView, GuestReturns, ReturnableLine } from "@/server/returns/service";

/**
 * Returns and exchanges on the Order Status page (plan §5 Phase 10, task 7):
 * "select Exchange or Return — no login required". Shown only under a
 * found order, so it sits behind the same ordering gate as the tracker.
 * The server decides everything (window, units, sizes) and re-checks it on
 * submit; this only offers what `POST /api/returns/lookup` said is possible.
 *
 * **Copy status: DRAFT, owner sign-off required before ordering opens.**
 * It promises nothing the system does not do: no prepaid label (not built),
 * no refund timeline beyond the published "5-7 business days".
 */

const GENERIC_ERROR = "Something went wrong. Please try again.";

const REASONS = [
  { value: "size_fit", label: "Size or fit" },
  { value: "defective", label: "Defective or damaged" },
  { value: "not_as_described", label: "Not as described" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Other" },
] as const;

const SELECT_CLASS = "border border-border-strong bg-background px-3 py-2 text-sm outline-none focus:border-foreground";

/** What the customer is told about one request — only what has actually happened. */
export function describeReturn(row: CustomerReturnView): string {
  const what = row.kind === "exchange" ? "Exchange" : "Return";
  switch (row.state) {
    case "requested":
      return `${what} requested. We'll review it and email you with pickup or drop-off details.`;
    case "approved":
      return `${what} approved. We'll email you with pickup or drop-off details if you haven't heard from us yet.`;
    case "rejected":
      return `${what} not approved. Contact support if you have questions.`;
    case "received":
      return row.refund?.status === "due"
        ? "We've received your item. Your refund is being processed."
        : "We've received your item and are checking it.";
    case "completed":
      if (row.replacement) return `Replacement shipped with ${row.replacement.courier}, AWB ${row.replacement.awb}.`;
      if (row.refund?.status === "refunded") return "Refunded to your original payment method.";
      if (row.refund?.status === "recorded") {
        return "Our team has issued your refund. It can take 5-7 business days to reach your original payment method.";
      }
      if (row.refund?.status === "queued") return "We've received your items. Your refund is being processed.";
      return "Closed after inspection. We'll contact you about your item.";
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as T & { error?: { message?: string } };
    if (response.ok && !json.error) return { ok: true, data: json };
    return { ok: false, message: json.error?.message ?? GENERIC_ERROR };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

function RequestForm({
  line,
  credentials,
  onDone,
}: {
  line: ReturnableLine;
  credentials: { orderNumber: string; email: string };
  onDone: () => void;
}) {
  const id = `return-${line.sku}`;
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("size_fit");
  const [size, setSize] = useState(line.exchangeSizes[0] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canExchange = line.exchangeSizes.length > 0;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await postJson("/api/returns/request", {
      ...credentials,
      sku: line.sku,
      quantity,
      kind: "exchange",
      reason,
      exchangeSize: size,
    });
    setPending(false);
    if (result.ok) onDone();
    else setError(result.message);
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={`${id}-title`} className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <p className={`text-sm ${canExchange ? "" : "text-muted"}`}>
        Exchange for another size{canExchange ? "" : " (no other size in stock)"}
      </p>
      <div className="flex flex-wrap gap-3">
        {line.availableUnits > 1 ? (
          <label className="flex flex-col gap-1 text-sm">
            Quantity
            <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className={SELECT_CLASS}>
              {Array.from({ length: line.availableUnits }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={SELECT_CLASS}>
            {REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {canExchange ? (
          <label className="flex flex-col gap-1 text-sm">
            New size
            <select value={size} onChange={(e) => setSize(e.target.value)} className={SELECT_CLASS}>
              {line.exchangeSizes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        Your new size ships once we receive your original pair, subject to stock at that time.
      </p>
      <div>
        <button
          type="submit"
          disabled={pending || !canExchange}
          className="bg-foreground px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
        >
          {pending ? "Sending…" : "Request exchange"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function OrderReturns({ orderNumber, email }: { orderNumber: string; email: string }) {
  const [data, setData] = useState<GuestReturns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void postJson<GuestReturns>("/api/returns/lookup", { orderNumber, email }).then((result) => {
      if (!current) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      current = false;
    };
  }, [orderNumber, email, version]);

  if (error) return <p className="mb-8 text-sm font-medium text-red-600">{error}</p>;
  if (!data) return <p className="mb-8 text-sm text-muted">Loading returns and exchanges…</p>;

  const requestable = data.open ? data.lines.filter((line) => line.availableUnits > 0 && !line.hasOpenRequest) : [];
  if (data.returns.length === 0 && requestable.length === 0 && !data.windowClosesAt) return null;

  return (
    <section aria-labelledby="returns-title" className="mb-10 border border-border p-5">
      <h2 id="returns-title" className="text-base font-bold">
        Exchange a size
      </h2>
      {data.windowClosesAt ? (
        <p className="mt-1 text-sm text-muted">
          {data.open
            ? `You can request an exchange or return until ${formatOrderDate(data.windowClosesAt)}.`
            : "The window for new exchange or return requests on this order has closed."}
        </p>
      ) : null}

      {data.returns.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {data.returns.map((row) => (
            <li key={row.id} className="text-sm">
              <span className="font-semibold">
                {row.productName} · {row.sizeLabel}
                {row.exchangeSize ? ` → ${row.exchangeSize}` : ""} · ×{row.quantity}
              </span>
              <span className="block text-muted">{describeReturn(row)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div role="status" aria-live="polite">
        {notice ? <p className="mt-4 text-sm font-medium">{notice}</p> : null}
      </div>

      {requestable.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4">
          {requestable.map((line) => (
            <li key={line.sku} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span id={`return-${line.sku}-title`} className="font-semibold">
                  {line.productName} · {line.colorway} · {line.sizeLabel}
                </span>
                <button
                  type="button"
                  aria-expanded={openSku === line.sku}
                  onClick={() => setOpenSku(openSku === line.sku ? null : line.sku)}
                  className="border border-border-strong px-4 py-2 text-sm font-semibold"
                >
                  Exchange a size
                </button>
              </div>
              {openSku === line.sku ? (
                <RequestForm
                  line={line}
                  credentials={{ orderNumber, email }}
                  onDone={() => {
                    setOpenSku(null);
                    setNotice("Request received. We'll review it and email you with pickup or drop-off details.");
                    setVersion((value) => value + 1);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
