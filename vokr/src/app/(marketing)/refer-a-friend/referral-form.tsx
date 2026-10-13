"use client";

/** `refer-a-friend.html`'s "Get your referral link" form — inert, no account/referral system exists yet. */
export function ReferralForm() {
  return (
    <>
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex max-w-md flex-wrap gap-3"
      >
        <label htmlFor="raf-email" className="sr-only">
          Your email address
        </label>
        <input
          id="raf-email"
          type="email"
          placeholder="Your email address"
          className="min-w-[220px] flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <button
          type="submit"
          aria-disabled="true"
          aria-describedby="referral-unavailable"
          className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
        >
          Get My Link
        </button>
      </form>
      {/* Visible reason this control is inert (§2A.6 row L1) — the
          former `title` tooltip was neither visible nor reliably announced. */}
      <p id="referral-unavailable" role="note" className="mt-3 text-sm text-muted">
        {"Referral links aren't available yet, so this form can't be submitted."}
      </p>
    </>
  );
}
