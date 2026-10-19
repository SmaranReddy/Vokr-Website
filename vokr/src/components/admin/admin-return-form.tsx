"use client";

import { useState, type FormEvent } from "react";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

const REASONS = [
  ["size_fit", "Size / fit"],
  ["defective", "Defective"],
  ["not_as_described", "Not as described"],
  ["changed_mind", "Changed mind"],
  ["other", "Other"],
] as const;

/**
 * Records a return or exchange the customer asked for by email or phone.
 * The server applies the customer's own checks (window, units, one open
 * request per item, same-price exchange); this form only collects the ask.
 */
export function AdminReturnForm({ orderNumber, skus }: { orderNumber: string; skus: string[] }) {
  const { post, pending, error } = useAdminPost();
  const [sku, setSku] = useState(skus[0] ?? "");
  const [kind, setKind] = useState<"return" | "exchange">("return");
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("size_fit");
  const [quantity, setQuantity] = useState(1);
  const [exchangeSize, setExchangeSize] = useState("");
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    const result = await post<{ return: { id: string } }>(`/api/admin/orders/${encodeURIComponent(orderNumber)}/returns`, {
      sku,
      quantity,
      kind,
      reason,
      ...(kind === "exchange" ? { exchangeSize: exchangeSize.trim() } : {}),
      note: note.trim(),
    });
    if (result) setSuccess("Recorded as requested.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex max-w-md flex-col gap-3" aria-label="Record a return or exchange">
      <p className="text-sm text-muted">For a customer who asked by email or phone. The usual checks apply.</p>
      <label className="flex flex-col gap-1 text-sm">
        Item
        <select value={sku} onChange={(e) => setSku(e.target.value)} className={INPUT_CLASS}>
          {skus.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Kind</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="admin-return-kind" checked={kind === "return"} onChange={() => setKind("return")} />
          Return
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="admin-return-kind" checked={kind === "exchange"} onChange={() => setKind("exchange")} />
          Exchange
        </label>
      </fieldset>
      {kind === "exchange" ? (
        <label className="flex flex-col gap-1 text-sm">
          Size wanted instead (e.g. IN 9)
          <input required maxLength={20} value={exchangeSize} onChange={(e) => setExchangeSize(e.target.value)} className={INPUT_CLASS} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={INPUT_CLASS}>
          {REASONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Quantity
        <input
          type="number"
          min={1}
          max={20}
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        How the customer asked (required)
        <input required minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
      </label>
      <div>
        <button type="submit" disabled={pending || !sku} className={BUTTON_CLASS}>
          {pending ? "Saving..." : "Record request"}
        </button>
      </div>
      <FormStatus error={error} success={success} />
    </form>
  );
}
