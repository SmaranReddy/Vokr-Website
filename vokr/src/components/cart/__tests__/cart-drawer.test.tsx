import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CartView } from "@/server/cart";

/**
 * Storefront-only launch (§2A.6 row L1): the drawer's Checkout must be
 * genuinely disabled — not a clickable no-op behind a tooltip — and the
 * reason must be visible, whether or not the bag has anything in it.
 */

let cart: CartView;

vi.mock("@/components/cart/cart-provider", () => ({
  useCart: () => ({
    cart,
    isOpen: true,
    closeCart: vi.fn(),
    error: null,
    isLoading: false,
    updateQuantity: vi.fn(),
    removeItem: vi.fn(),
  }),
}));

const { CartDrawer } = await import("@/components/cart/cart-drawer");
const { ORDERING_UNAVAILABLE_MESSAGE } = await import("@/config/commerce");

const FILLED_CART: CartView = {
  cartId: "cart-1",
  items: [
    {
      cartItemId: "item-1",
      variantId: "v-1",
      quantity: 1,
      available: true,
      sku: "VOKR-TEST-8",
      productSlug: "model-x",
      productName: "Model x",
      sizeLabel: "IN 8",
      colorway: "White/Black",
      unitPricePaise: 999_500,
      lineSubtotalPaise: 999_500,
      gstRateBps: 1800,
      lineTaxPaise: 152_466,
      quantityAvailable: 5,
      inStock: true,
    },
  ],
  subtotalPaise: 999_500,
  taxPaise: 152_466,
  totalPaise: 999_500,
};

afterEach(cleanup);

/** The text of every element `aria-describedby` points at, in order. */
function accessibleDescription(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("CartDrawer — ordering disabled", () => {
  it("disables Checkout and describes why in visible text", () => {
    cart = FILLED_CART;
    render(<CartDrawer />);

    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect((checkout as HTMLButtonElement).disabled).toBe(true);
    expect(accessibleDescription(checkout)).toBe(ORDERING_UNAVAILABLE_MESSAGE);
    expect(checkout.hasAttribute("title")).toBe(false);
  });

  it("tells a customer with an empty bag that ordering is unavailable", () => {
    cart = { cartId: null, items: [], subtotalPaise: 0, taxPaise: 0, totalPaise: 0 };
    render(<CartDrawer />);

    expect(screen.getByText("Your bag is empty.")).toBeTruthy();
    expect(screen.getByText(ORDERING_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Checkout" })).toBeNull();
  });
});
