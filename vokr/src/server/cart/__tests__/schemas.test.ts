import { describe, expect, it } from "vitest";

import { addItemBodySchema, updateQuantityBodySchema } from "@/server/cart/schemas";

/**
 * The unit half of the R6 regression (plan §5 Phase 5, Testing
 * Requirements): a request body carrying a client-chosen `price` or
 * `total` must never reach the service layer. `.strict()` rejects it at
 * the request-validation boundary, generically — the specific field name
 * doesn't matter.
 */
describe("cart request schemas reject a client-supplied price (R6)", () => {
  it("addItemBodySchema rejects a body that also carries price/total", () => {
    const result = addItemBodySchema.safeParse({
      variantId: "01a07f95-a22e-78b5-80fb-e470c9188fb8",
      quantity: 1,
      price: 100,
      total: 100,
    });
    expect(result.success).toBe(false);
  });

  it("addItemBodySchema accepts the legitimate shape", () => {
    const result = addItemBodySchema.safeParse({
      variantId: "01a07f95-a22e-78b5-80fb-e470c9188fb8",
      quantity: 1,
    });
    expect(result.success).toBe(true);
  });

  it("addItemBodySchema rejects quantity outside 1-10", () => {
    expect(
      addItemBodySchema.safeParse({
        variantId: "01a07f95-a22e-78b5-80fb-e470c9188fb8",
        quantity: 11,
      }).success,
    ).toBe(false);
    expect(
      addItemBodySchema.safeParse({
        variantId: "01a07f95-a22e-78b5-80fb-e470c9188fb8",
        quantity: 0,
      }).success,
    ).toBe(false);
  });

  it("updateQuantityBodySchema rejects a body that also carries price", () => {
    const result = updateQuantityBodySchema.safeParse({
      quantity: 2,
      price: 999_500,
    });
    expect(result.success).toBe(false);
  });

  it("updateQuantityBodySchema accepts the legitimate shape", () => {
    expect(updateQuantityBodySchema.safeParse({ quantity: 3 }).success).toBe(
      true,
    );
  });
});
