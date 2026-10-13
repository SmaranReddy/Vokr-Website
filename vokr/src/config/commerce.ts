/**
 * Storefront-only launch gate (Vokr-Implementation-Plan.md §2A.6 row L1).
 *
 * Checkout and payment processing are not production-ready, so every
 * purchase affordance — PDP "Add to Cart", the cart drawer's "Checkout" —
 * is disabled and says why, regardless of variant status or stock.
 *
 * Deliberately a hardcoded constant rather than an environment variable:
 * enabling ordering must be a reviewed code change that lands together
 * with working payment and fulfilment, never a deployment-config toggle.
 */
export const ORDERING_ENABLED: boolean = false;

/** Visible, customer-facing explanation shown next to every disabled purchase control. */
export const ORDERING_UNAVAILABLE_MESSAGE =
  "Online ordering isn't available yet. You can browse the collection, but orders can't be placed at this time.";
