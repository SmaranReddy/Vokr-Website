"use client";

/**
 * `wholesale-orders.html`'s "Request wholesale pricing" form
 * (`<form onsubmit="return false;">`). There is no wholesale-inquiry
 * backend yet, so — same treatment as `order-status-form.tsx` — this
 * stays visually present but inert: a disabled-look submit button with
 * `aria-disabled` and a visible explanatory note, rather than a fake endpoint or a
 * silent `onsubmit="return false;"`.
 */
export function WholesaleInquiryForm() {
  return (
    <>
      <form
        onSubmit={(event) => event.preventDefault()}
        className="max-w-xl space-y-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sr-only" htmlFor="ws-business-name">
            Business name
          </label>
          <input
            id="ws-business-name"
            type="text"
            placeholder="Business name"
            className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
          <label className="sr-only" htmlFor="ws-your-name">
            Your name
          </label>
          <input
            id="ws-your-name"
            type="text"
            placeholder="Your name"
            className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sr-only" htmlFor="ws-business-email">
            Business email
          </label>
          <input
            id="ws-business-email"
            type="email"
            placeholder="Business email"
            className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
          <label className="sr-only" htmlFor="ws-order-volume">
            Estimated order volume
          </label>
          <input
            id="ws-order-volume"
            type="text"
            placeholder="Estimated order volume"
            className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
        </div>
        <label className="sr-only" htmlFor="ws-about">
          Tell us about your business
        </label>
        <textarea
          id="ws-about"
          rows={4}
          placeholder="Tell us about your business"
          className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <button
          type="submit"
          aria-disabled="true"
          aria-describedby="wholesale-unavailable"
          className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
        >
          Submit Inquiry
        </button>
      </form>
      {/* Visible reason this control is inert (§2A.6 row L1) — the
          former `title` tooltip was neither visible nor reliably announced. */}
      <p id="wholesale-unavailable" role="note" className="mt-3 text-sm text-muted">
        {"Online wholesale inquiries aren't available yet, so this form can't be submitted."}
      </p>
    </>
  );
}
