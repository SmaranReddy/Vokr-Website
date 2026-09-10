import { z } from "zod";

import { MAX_CART_ITEM_QUANTITY, MIN_CART_ITEM_QUANTITY } from "@/lib/cart";

/**
 * `.strict()` is the actual mechanism behind "no endpoint accepts a
 * price, a total or a tax amount in its request body" (plan §5 Phase 5,
 * API Impact) — a body carrying `price`/`total` alongside a legitimate
 * `variantId`/`quantity` fails validation before the service layer is
 * ever reached, generically, for any extra field, not just the ones
 * named here.
 */
export const addItemBodySchema = z
  .object({
    variantId: z.uuid(),
    quantity: z
      .number()
      .int()
      .min(MIN_CART_ITEM_QUANTITY)
      .max(MAX_CART_ITEM_QUANTITY),
  })
  .strict();

export const updateQuantityBodySchema = z
  .object({
    quantity: z
      .number()
      .int()
      .min(MIN_CART_ITEM_QUANTITY)
      .max(MAX_CART_ITEM_QUANTITY),
  })
  .strict();
