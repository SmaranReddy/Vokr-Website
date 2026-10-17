"use client";

import { useState, type FormEvent } from "react";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

interface Decision {
  sku: string;
  qcPassed: boolean;
  restock: boolean;
}

/** A failed delivery is back: per item, the quality check and whether it goes back into stock. */
export function RtoReceiveForm({ orderNumber, skus }: { orderNumber: string; skus: string[] }) {
  const { post, pending, error } = useAdminPost();
  const [decisions, setDecisions] = useState<Decision[]>(() => skus.map((sku) => ({ sku, qcPassed: true, restock: true })));
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  function update(index: number, patch: Partial<Decision>) {
    setDecisions((current) => current.map((decision, i) => (i === index ? { ...decision, ...patch } : decision)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    const result = await post<{ restockedUnits: number }>(`/api/admin/orders/${encodeURIComponent(orderNumber)}/rto`, {
      items: decisions.map((decision) => ({ ...decision, restock: decision.qcPassed && decision.restock })),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (result) setSuccess(`Recorded. ${result.restockedUnits} unit(s) back in stock.`);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-muted">
        Record the parcel as back at the warehouse. Refund, if needed, with the full refund on this page; a re-ship is not
        built yet.
      </p>
      {decisions.map((decision, index) => (
        <fieldset key={decision.sku} className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">{decision.sku}</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={decision.qcPassed} onChange={(e) => update(index, { qcPassed: e.target.checked })} />
            Passed quality check
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={decision.qcPassed && decision.restock}
              disabled={!decision.qcPassed}
              onChange={(e) => update(index, { restock: e.target.checked })}
            />
            Put back into sellable stock
          </label>
        </fieldset>
      ))}
      <label className="flex flex-col gap-1 text-sm">
        Note (optional)
        <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={BUTTON_CLASS}>
          {pending ? "Saving..." : "RTO received"}
        </button>
      </div>
      <FormStatus error={error} success={success} />
    </form>
  );
}
