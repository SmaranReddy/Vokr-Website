"use client";

import { useState, type FormEvent } from "react";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

export function AdjustStockForm({ variantId, sku, onHand }: { variantId: string; sku: string; onHand: number }) {
  const { post, pending, error } = useAdminPost();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    const parsed = Number(delta);
    if (!Number.isInteger(parsed) || parsed === 0) return;
    const result = await post<{ inventory: { quantityOnHand: number } }>("/api/admin/inventory/adjust", {
      variantId,
      delta: parsed,
      expectedOnHand: onHand,
      reason: reason.trim(),
    });
    if (result) {
      setSuccess(`On hand is now ${result.inventory.quantityOnHand}.`);
      setDelta("");
      setReason("");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-xs">
        Change for {sku} (+/-)
        <input
          type="number"
          required
          step={1}
          min={-10000}
          max={10000}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          className={`${INPUT_CLASS} w-24`}
        />
      </label>
      <label className="flex flex-col text-xs">
        Reason for {sku}
        <input
          required
          minLength={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${INPUT_CLASS} w-56`}
        />
      </label>
      <button type="submit" disabled={pending} className={BUTTON_CLASS}>
        {pending ? "Saving..." : "Adjust"}
      </button>
      <div className="basis-full">
        <FormStatus
          error={error?.code === "CONFLICT" ? { ...error, message: `${error.message} Reload the page.` } : error}
          success={success}
        />
      </div>
    </form>
  );
}
