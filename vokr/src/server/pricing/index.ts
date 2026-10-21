import { CheckoutStaleError, OutOfStockError, ValidationError } from "@/lib/errors";
import { gstStateCode } from "@/lib/gst-states";
import { listProducts, type CatalogProduct, type CatalogVariant } from "@/server/catalog";
import { prisma } from "@/server/db/client";
import {
  FIRST_ORDER_DISCOUNT_BPS,
  FIRST_ORDER_DISCOUNT_KIND,
  lineDiscountPaise as computeLineDiscount,
} from "@/server/discounts/first-order";

import {
  FREE_SHIPPING_THRESHOLD_PAISE,
  getCodHandlingFeePaise,
  getFlatShippingFeePaise,
  getSellerState,
} from "./config";

export type CheckoutPaymentMethod = "prepaid" | "cod";

export interface PricingLine {
  variantId: string;
  sku: string;
  productName: string;
  hsnCode: string;
  sizeLabel: string;
  colorway: string;
  quantity: number;
  unitPricePaise: number;
  lineSubtotalPaise: number;
  /** This line's share of the order discount; 0 when none. Absent on snapshots priced before discounts existed. */
  lineDiscountPaise?: number;
  gstRateBps: number;
  /** The GST embedded within `lineSubtotalPaise - lineDiscountPaise` (prices are GST-inclusive) — a breakdown, not an addition. */
  lineTaxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface PricingSnapshot {
  computedAt: string;
  expiresAt: string;
  gstSplit: "intra_state" | "inter_state";
  shipToState: string;
  sellerState: string;
  paymentMethod: CheckoutPaymentMethod;
  lines: PricingLine[];
  subtotalPaise: number;
  /** The discount applied, if any. Absent on snapshots priced before discounts existed. */
  discount?: { kind: typeof FIRST_ORDER_DISCOUNT_KIND; rateBps: number } | null;
  /** Sum of the lines' `lineDiscountPaise`; taken off `subtotalPaise`. */
  discountPaise?: number;
  taxPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
}

export const PRICING_SNAPSHOT_TTL_MS = 15 * 60 * 1000;

function findVariantInCatalog(
  catalog: readonly CatalogProduct[],
  variantId: string,
): { product: CatalogProduct; variant: CatalogVariant } | undefined {
  for (const product of catalog) {
    const variant = product.variants.find(
      (candidate) => candidate.id === variantId && candidate.isPurchasable,
    );
    if (variant) {
      return { product, variant };
    }
  }
  return undefined;
}

/**
 * Splits one line's already-rounded GST between CGST/SGST (intra-state)
 * or IGST (inter-state) so the two halves always sum to exactly
 * `lineTaxPaise` — never independently rounded, which could otherwise
 * disagree with the line total by a paise (plan §5 Phase 6, task 5: "the
 * total is the sum of rounded lines — never a rounded sum").
 */
function splitGst(
  lineTaxPaise: number,
  intraState: boolean,
): Pick<PricingLine, "cgstPaise" | "sgstPaise" | "igstPaise"> {
  if (!intraState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: lineTaxPaise };
  }
  const cgstPaise = Math.floor(lineTaxPaise / 2);
  const sgstPaise = lineTaxPaise - cgstPaise;
  return { cgstPaise, sgstPaise, igstPaise: 0 };
}

function buildLine(
  quantity: number,
  product: CatalogProduct,
  variant: CatalogVariant,
  intraState: boolean,
  discountBps: number,
): PricingLine {
  if (product.gstRateBps === null) {
    // Structurally unreachable — see cart/service.ts's identical guard.
    throw new Error(
      `pricing: purchasable variant ${variant.id} belongs to product ${product.id}, which has no gst_rate_bps.`,
    );
  }
  if (product.hsnCode === null) {
    throw new Error(
      `pricing: purchasable variant ${variant.id} belongs to product ${product.id}, which has no hsn_code.`,
    );
  }

  const lineSubtotalPaise = variant.pricePaise * quantity;
  const lineDiscountPaise = computeLineDiscount(lineSubtotalPaise, discountBps);
  // GST is on what is actually charged for the goods: the line after its
  // discount. Half-up: `Math.round` rounds .5 toward +Infinity, which for a
  // non-negative value is round-half-up (plan §5 Phase 6, task 5).
  const lineTaxPaise = Math.round(
    ((lineSubtotalPaise - lineDiscountPaise) * product.gstRateBps) /
      (10_000 + product.gstRateBps),
  );

  return {
    variantId: variant.id,
    sku: variant.sku,
    productName: product.name,
    hsnCode: product.hsnCode,
    sizeLabel: variant.sizeLabel,
    colorway: variant.colorway,
    quantity,
    unitPricePaise: variant.pricePaise,
    lineSubtotalPaise,
    lineDiscountPaise,
    gstRateBps: product.gstRateBps,
    lineTaxPaise,
    ...splitGst(lineTaxPaise, intraState),
  };
}

export interface ComputePricingParams {
  cartId: string;
  shipToState: string;
  paymentMethod: CheckoutPaymentMethod;
  /** The ship-to phone has no first-order claim yet (`server/discounts/first-order.ts`); the caller decides. */
  firstOrderDiscount?: boolean;
}

/**
 * The single function every downstream reader (Razorpay amount, order
 * total) must call through — never recompute independently (plan §5
 * Phase 6, task 7, Exit Criteria). Throws {@link ValidationError} for an
 * empty cart and {@link ConflictError} if any line is no longer
 * purchasable, rather than silently dropping or partially pricing it —
 * unlike the cart view (which tolerates unavailable lines so the
 * customer can remove them), checkout must not price an order it cannot
 * actually fulfil.
 */
export async function computePricing({
  cartId,
  shipToState,
  paymentMethod,
  firstOrderDiscount = false,
}: ComputePricingParams): Promise<PricingSnapshot> {
  const [items, catalog] = await Promise.all([
    prisma.cartItem.findMany({
      where: { cartId },
      orderBy: { addedAt: "asc" },
      select: { variantId: true, quantity: true },
    }),
    listProducts(),
  ]);

  if (items.length === 0) {
    throw new ValidationError("Cannot price an empty cart.");
  }

  const sellerState = getSellerState();
  const intraState = shipToState === sellerState;
  // Validates both names resolve in the fixed enumeration before pricing
  // proceeds — a malformed state should never reach the split logic.
  gstStateCode(shipToState);
  gstStateCode(sellerState);
  const discountBps = firstOrderDiscount ? FIRST_ORDER_DISCOUNT_BPS : 0;

  const lines: PricingLine[] = items.map((item) => {
    const found = findVariantInCatalog(catalog, item.variantId);
    if (!found) {
      throw new CheckoutStaleError(
        "One or more items in your cart are no longer available. Please review your cart.",
      );
    }
    if (found.variant.quantityAvailable < item.quantity) {
      throw new OutOfStockError("Not enough stock available for one or more items in your cart.", [
        { variantId: item.variantId, requested: item.quantity, available: found.variant.quantityAvailable },
      ]);
    }
    return buildLine(item.quantity, found.product, found.variant, intraState, discountBps);
  });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
  const discountPaise = lines.reduce((sum, line) => sum + (line.lineDiscountPaise ?? 0), 0);
  const taxPaise = lines.reduce((sum, line) => sum + line.lineTaxPaise, 0);
  // Judged after the discount: the threshold is on what the goods cost.
  const shippingPaise =
    subtotalPaise - discountPaise > FREE_SHIPPING_THRESHOLD_PAISE ? 0 : getFlatShippingFeePaise();
  const codFeePaise = paymentMethod === "cod" ? getCodHandlingFeePaise() : 0;
  const totalPaise = subtotalPaise - discountPaise + shippingPaise + codFeePaise;

  const computedAt = new Date();
  const expiresAt = new Date(computedAt.getTime() + PRICING_SNAPSHOT_TTL_MS);

  return {
    computedAt: computedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    gstSplit: intraState ? "intra_state" : "inter_state",
    shipToState,
    sellerState,
    paymentMethod,
    lines,
    subtotalPaise,
    discount:
      discountPaise > 0 ? { kind: FIRST_ORDER_DISCOUNT_KIND, rateBps: FIRST_ORDER_DISCOUNT_BPS } : null,
    discountPaise,
    taxPaise,
    shippingPaise,
    codFeePaise,
    totalPaise,
  };
}
