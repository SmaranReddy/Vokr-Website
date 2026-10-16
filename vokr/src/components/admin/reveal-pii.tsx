"use client";

import { useState, type FormEvent } from "react";

import { FormStatus } from "./form-status";
import { BUTTON_CLASS, INPUT_CLASS } from "./format";
import { useAdminPost } from "./use-admin-post";

interface Customer {
  email: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export function RevealPii({ orderNumber }: { orderNumber: string }) {
  const { post, pending, error } = useAdminPost();
  const [reason, setReason] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await post<{ customer: Customer }>(
      `/api/admin/orders/${encodeURIComponent(orderNumber)}/reveal`,
      { reason: reason.trim() },
    );
    if (result) setCustomer(result.customer);
  }

  return (
    <div className="max-w-md">
      {customer ? (
        <div>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Name</dt>
            <dd>{customer.name}</dd>
            <dt className="text-muted">Email</dt>
            <dd>{customer.email}</dd>
            <dt className="text-muted">Phone</dt>
            <dd>{customer.phone}</dd>
            <dt className="text-muted">Address</dt>
            <dd>
              {customer.line1}
              {customer.line2 ? <>, {customer.line2}</> : null}, {customer.city}, {customer.state} {customer.pincode}
            </dd>
          </dl>
          <button
            type="button"
            className={`${BUTTON_CLASS} mt-2`}
            onClick={() => {
              setCustomer(null);
              setReason("");
            }}
          >
            Hide
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-muted">Revealing customer details is recorded in the audit trail with your reason.</p>
          <label className="flex flex-col gap-1 text-sm">
            Reason (3-300 characters)
            <input required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLASS} />
          </label>
          <div>
            <button type="submit" disabled={pending} className={BUTTON_CLASS}>
              {pending ? "Revealing..." : "Reveal customer details"}
            </button>
          </div>
        </form>
      )}
      <FormStatus error={error} />
    </div>
  );
}
