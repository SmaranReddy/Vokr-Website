import { requireServerEnv } from "@/lib/env";
import { isValidGstState } from "@/lib/gst-states";

/**
 * Values `computePricing()` needs but this codebase must not invent —
 * same discipline as `products.gst_rate_bps` (decision D2): nullable at
 * rest, and every function here throws at the point of use rather than
 * defaulting, so an unanswered decision fails loudly instead of silently
 * mis-charging a customer.
 */

/**
 * Free-shipping threshold. The one figure Phase 6's shipping rule is
 * allowed to hard-code — it is already published, verbatim, in
 * `terms.html`, the PDP and the cart drawer ("Free shipping on orders
 * over ₹4,999"). The flat fee charged *below* that threshold is not
 * published anywhere and is not hard-coded here — see
 * {@link getFlatShippingFeePaise}.
 */
export const FREE_SHIPPING_THRESHOLD_PAISE = 499_900;

function readPositiveIntEnv(name: string, raw: string | undefined): number {
  if (!raw) {
    throw new Error(
      `${name} is not set. This is decision D11 ` +
        "(Vokr-Implementation-Plan.md §0.3) — a commercial amount this " +
        "codebase must not invent. Checkout cannot price an order until " +
        "it is set.",
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (paise), got "${raw}".`);
  }
  return value;
}

/** Flat shipping fee (paise) for a subtotal at or below {@link FREE_SHIPPING_THRESHOLD_PAISE}. Throws if unset (D11). */
export function getFlatShippingFeePaise(): number {
  return readPositiveIntEnv(
    "CHECKOUT_FLAT_SHIPPING_FEE_PAISE",
    requireServerEnv().CHECKOUT_FLAT_SHIPPING_FEE_PAISE,
  );
}

/** COD handling fee (paise), shown as its own line. Throws if unset (D11). */
export function getCodHandlingFeePaise(): number {
  return readPositiveIntEnv(
    "CHECKOUT_COD_HANDLING_FEE_PAISE",
    requireServerEnv().CHECKOUT_COD_HANDLING_FEE_PAISE,
  );
}

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
