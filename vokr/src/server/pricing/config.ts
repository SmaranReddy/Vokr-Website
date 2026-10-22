import { requireServerEnv } from "@/lib/env";
import { isValidGstState } from "@/lib/gst-states";

/**
 * Values `computePricing()` needs but this codebase must not invent —
 * same discipline as `products.gst_rate_bps` (decision D2): nullable at
 * rest, and every function here throws at the point of use rather than
 * defaulting, so an unanswered decision fails loudly instead of silently
 * mis-charging a customer.
 */

/*
 * Shipping is charged on every order at the delivery PIN code's fee
 * (`serviceable_pincodes.shipping_fee_paise`, from the courier's rate card)
 * — no free-shipping threshold, and no COD (owner decisions, 21 Oct 2026).
 */

/**
 * The seller's registered GST state, for the CGST+SGST vs IGST split.
 * Blocked on decision D3 (legal entity + GST registration) — throws
 * rather than guessing until D3 is answered and this is set.
 */
export function getSellerState(): string {
  const raw = requireServerEnv().CHECKOUT_SELLER_STATE;
  if (!raw) {
    throw new Error(
      "CHECKOUT_SELLER_STATE is not set. This is decision D3 " +
        "(Vokr-Implementation-Plan.md §0.3, legal entity + GST " +
        "registration) — pricing cannot compute the CGST/SGST vs IGST " +
        "split until the registered seller state is known.",
    );
  }
  if (!isValidGstState(raw)) {
    throw new Error(
      `CHECKOUT_SELLER_STATE "${raw}" is not one of the fixed GST state ` +
        "enumeration's names (src/lib/gst-states.ts).",
    );
  }
  return raw;
}
