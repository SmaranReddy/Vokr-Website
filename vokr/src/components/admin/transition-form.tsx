"use client";

import { useState, type FormEvent } from "react";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

const CONFIRM_TARGETS = new Set(["cancelled", "rto", "returned"]);

export function TransitionForm({ orderNumber, nextStatuses }: { orderNumber: string; nextStatuses: string[] }) {
  const { post, pending, error } = useAdminPost();
  const [to, setTo] = useState(nextStatuses[0] ?? "");
  const [note, setNote] = useState("");
  const [courier, setCourier] = useState("");
  const [awb, setAwb] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  if (nextStatuses.length === 0) return <p className="text-sm text-muted">No further status changes are available.</p>;
  const selected = nextStatuses.includes(to) ? to : (nextStatuses[0] ?? "");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    if (CONFIRM_TARGETS.has(selected) && !window.confirm(`Mark ${orderNumber} as ${selected}? This cannot be undone.`)) {
      return;
    }
    const body: Record<string, string> = { to: selected };
    if (note.trim()) body.note = note.trim();
    if (selected === "shipped") {
      body.courier = courier.trim();
      body.awb = awb.trim();
    }
    const result = await post<{ changed: boolean; status: string }>(
      `/api/admin/orders/${encodeURIComponent(orderNumber)}/transition`,
      body,
    );
    if (result) setSuccess(result.changed ? `Status is now ${result.status}.` : "No change (already in that status).");
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Move to
        <select value={selected} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS}>
          {nextStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      {selected === "shipped" ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Courier
            <input required maxLength={60} value={courier} onChange={(e) => setCourier(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            AWB
            <input
              required
              minLength={4}
              maxLength={40}
              pattern="[A-Za-z0-9\-]{4,40}"
              title="4-40 letters, digits or hyphens"
              value={awb}
              onChange={(e) => setAwb(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        </>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        Note (optional)
        <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={BUTTON_CLASS}>
          {pending ? "Saving..." : "Change status"}
        </button>
      </div>
      <FormStatus error={error} success={success} />
    </form>
  );
}
