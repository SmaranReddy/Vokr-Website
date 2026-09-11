"use client";

/**
 * `support-order-status.html`'s tracking form. Left inert rather than
 * bound to a fake endpoint: there is no `Order` model yet — order
 * tracking is Phase 9/10's job — so unlike the newsletter/contact forms
 * (task 10), there is no real endpoint to bind this one to yet. An
 * honest, labelled non-submit beats either a dead `onsubmit="return
 * false;"` or a form that lies about what it does.
 */
export function OrderStatusForm() {
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="mb-8 flex flex-col gap-3 sm:flex-row"
    >
      <label htmlFor="order-number" className="sr-only">
        Order number
      </label>
      <input
        id="order-number"
        type="text"
        placeholder="Order number (e.g. VK-10234)"
        className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <label htmlFor="order-email" className="sr-only">
        Email address
      </label>
      <input
        id="order-email"
        type="email"
        placeholder="Email address"
        className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <button
        type="submit"
        aria-disabled="true"
        title="Order tracking launches once real orders exist (Phase 9)"
        className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
      >
        Track Order
      </button>
    </form>
  );
}
