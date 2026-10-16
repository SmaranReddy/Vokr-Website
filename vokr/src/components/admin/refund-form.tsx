"use client";

import { useState, type FormEvent } from "react";

import { formatPaiseAsRupees } from "@/lib/currency";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

export function RefundForm({ orderNumber, amountPaise }: { orderNumber: string; amountPaise: number }) {
  const { post, pending, error } = useAdminPost();
  const [confirmOrderNumber, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    const result = await post<{ queued: true; amountPaise: number }>(
      `/api/admin/orders/${encodeURIComponent(orderNumber)}/refund`,
      { confirmOrderNumber: confirmOrderNumber.trim(), reason: reason.trim() },
    );
    if (result) setSuccess(`Refund of ${formatPaiseAsRupees(result.amountPaise)} queued.`);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-muted">
        This queues a FULL refund of {formatPaiseAsRupees(amountPaise)}. The maintenance job processes it on its next run
        (every 5 minutes) once Razorpay keys are configured; until then it waits on the Exceptions page. Refunds never restock: adjust stock in Inventory if units come back.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Retype the order number ({orderNumber}) to confirm
        <input required value={confirmOrderNumber} onChange={(e) => setConfirm(e.target.value)} className={INPUT_CLASS} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Reason (3-300 characters)
        <input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLASS} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={BUTTON_CLASS}>
          {pending ? "Queuing..." : "Queue full refund"}
        </button>
      </div>
      <FormStatus error={error} success={success} />
    </form>
  );
}
