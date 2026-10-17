"use client";

import { useState, type FormEvent } from "react";

import { formatPaiseAsRupees } from "@/lib/currency";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

export interface ReturnActionRow {
  id: string;
  kind: "return" | "exchange" | "rto";
  state: "requested" | "approved" | "rejected" | "received" | "completed";
  refundMode: "full_order_queued" | "manual_due" | null;
  refundReference: string | null;
  refundDuePaise: number | null;
  exchangeSize: string | null;
}

/** The one next step a return, exchange or RTO row allows, as a small form. */
export function ReturnActions({
  orderNumber,
  row,
  refundable,
}: {
  orderNumber: string;
  row: ReturnActionRow;
  /** The order has a captured online payment (prepaid). */
  refundable: boolean;
}) {
  const { post, pending, error } = useAdminPost();
  const [success, setSuccess] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [qcPassed, setQcPassed] = useState(true);
  const [restock, setRestock] = useState(true);
  const [courier, setCourier] = useState("");
  const [awb, setAwb] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [refundId, setRefundId] = useState("");

  const base = `/api/admin/returns/${encodeURIComponent(row.id)}`;
  async function send(url: string, body: unknown, done: string) {
    setSuccess(null);
    const result = await post<Record<string, unknown>>(url, body);
    if (result) setSuccess(done);
  }
  const optionalNote = note.trim() ? { note: note.trim() } : {};
  const status = <FormStatus error={error} success={success} />;
  const noteInput = (
    <label className="flex flex-col gap-1 text-sm">
      Note (optional)
      <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={INPUT_CLASS} />
    </label>
  );
  const confirmInput = (
    <label className="flex flex-col gap-1 text-sm">
      Retype the order number ({orderNumber}) to confirm
      <input required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT_CLASS} autoComplete="off" />
    </label>
  );

  if (row.state === "requested") {
    const decide = (decision: "approve" | "reject") =>
      void send(base, { action: "decide", input: { decision, ...optionalNote } }, decision === "approve" ? "Approved." : "Rejected.");
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          decide("approve");
        }}
        className="flex max-w-sm flex-col gap-2"
      >
        {noteInput}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Approve
          </button>
          <button type="button" disabled={pending} onClick={() => decide("reject")} className={BUTTON_CLASS}>
            Reject
          </button>
        </div>
        {status}
      </form>
    );
  }

  if (row.state === "approved") {
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(base, { action: "receive", input: { qcPassed, restock: qcPassed && restock, ...optionalNote } }, "Received.");
        }}
        className="flex max-w-sm flex-col gap-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={qcPassed} onChange={(e) => setQcPassed(e.target.checked)} />
          Passed quality check
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={qcPassed && restock}
            disabled={!qcPassed}
            onChange={(e) => setRestock(e.target.checked)}
          />
          Put back into sellable stock
        </label>
        {noteInput}
        <div>
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Mark received
          </button>
        </div>
        {status}
      </form>
    );
  }

  if (row.state === "received" && row.kind === "exchange") {
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(base, { action: "dispatch", input: { courier: courier.trim(), awb: awb.trim() } }, "Replacement shipped.");
        }}
        className="flex max-w-sm flex-col gap-2"
      >
        <p className="text-sm text-muted">Ship size {row.exchangeSize}. Its stock is taken when you submit.</p>
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
        <div>
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Replacement shipped
          </button>
        </div>
        {status}
      </form>
    );
  }

  if (row.state === "received" && row.kind === "return" && row.refundMode === null) {
    if (!refundable) return <p className="text-sm text-muted">No captured online payment to refund.</p>;
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(
            `${base}/refund`,
            { action: "refund", input: { confirmOrderNumber: confirm.trim(), reason: reason.trim() } },
            "Refund settled.",
          );
        }}
        className="flex max-w-sm flex-col gap-2"
      >
        <p className="text-sm text-muted">
          If every item of the order is back, this queues the order&apos;s full refund. Otherwise it records this line&apos;s
          amount as due, to refund by hand in the Razorpay dashboard.
        </p>
        {confirmInput}
        <label className="flex flex-col gap-1 text-sm">
          Reason (3-300 characters)
          <input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLASS} />
        </label>
        <div>
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Refund this return
          </button>
        </div>
        {status}
      </form>
    );
  }

  if (row.refundMode === "manual_due" && !row.refundReference) {
    return (
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(
            `${base}/refund`,
            { action: "record", input: { confirmOrderNumber: confirm.trim(), refundId: refundId.trim() } },
            "Refund recorded.",
          );
        }}
        className="flex max-w-sm flex-col gap-2"
      >
        <p className="text-sm text-muted">
          Refund {formatPaiseAsRupees(row.refundDuePaise ?? 0)} in the Razorpay dashboard (the order&apos;s payment, partial
          refund), then record the refund id here.
        </p>
        {confirmInput}
        <label className="flex flex-col gap-1 text-sm">
          Razorpay refund id
          <input
            required
            pattern="rfnd_[A-Za-z0-9]{6,40}"
            value={refundId}
            onChange={(e) => setRefundId(e.target.value)}
            className={INPUT_CLASS}
            autoComplete="off"
          />
        </label>
        <div>
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Record refund
          </button>
        </div>
        {status}
      </form>
    );
  }

  return <span className="text-sm text-muted">-</span>;
}
