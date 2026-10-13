import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogVariant } from "@/server/catalog";

/**
 * Storefront-only launch (§2A.6 row L1): checkout and payment are not
 * production-ready, so the PDP must never let a customer start a purchase —
 * even for a variant that is `active` and in stock — and must say why in
 * visible text, not only a tooltip or screen-reader-only copy.
 */

const addItem = vi.fn();
const openCart = vi.fn();

vi.mock("@/components/cart/cart-provider", () => ({
  useCart: () => ({ addItem, openCart, isLoading: false }),
}));

const { PdpPurchasePanel } = await import("@/components/shop/pdp-purchase-panel");
const { ORDERING_ENABLED, ORDERING_UNAVAILABLE_MESSAGE } = await import(
  "@/config/commerce"
);

function variant(overrides: Partial<CatalogVariant>): CatalogVariant {
  return {
    id: "v-active",
    sku: "VOKR-TEST-8",
    sizeLabel: "IN 8",
    colorway: "Black",
    pricePaise: 999_500,
    weightGrams: 800,
    position: 0,
    quantityAvailable: 10,
    isPurchasable: true,
    ...overrides,
  };
}

const VARIANTS = [
  variant({}),
  variant({ id: "v-draft", sku: "VOKR-TEST-9", sizeLabel: "IN 9", isPurchasable: false }),
];

beforeEach(() => {
  addItem.mockReset();
  openCart.mockReset();
});

afterEach(cleanup);

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

/** The text of every element `aria-describedby` points at, in order. */
function accessibleDescription(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("PdpPurchasePanel — ordering disabled", () => {
  it("ships with ordering disabled", () => {
    expect(ORDERING_ENABLED).toBe(false);
  });

  it("disables Add to Cart even after a purchasable size is selected", () => {
    render(<PdpPurchasePanel variants={VARIANTS} />);

    fireEvent.click(screen.getByRole("button", { name: "IN 8" }));
    const addToCart = screen.getByRole("button", { name: /Add to Cart/ });

    expect(isDisabled(addToCart)).toBe(true);
    fireEvent.click(addToCart);
    expect(addItem).not.toHaveBeenCalled();
    expect(openCart).not.toHaveBeenCalled();
  });

  it("explains, in visible text linked by aria-describedby, that ordering is unavailable", () => {
    render(<PdpPurchasePanel variants={VARIANTS} />);

    const addToCart = screen.getByRole("button", { name: /Add to Cart/ });
    const describedBy = addToCart.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const note = document.getElementById(describedBy!);
    expect(note).not.toBeNull();
    expect(note!.textContent).toBe(ORDERING_UNAVAILABLE_MESSAGE);
    expect(note!.classList.contains("sr-only")).toBe(false);
    expect(accessibleDescription(addToCart)).toBe(ORDERING_UNAVAILABLE_MESSAGE);
  });

  it("keeps a non-purchasable size disabled", () => {
    render(<PdpPurchasePanel variants={VARIANTS} />);
    expect(isDisabled(screen.getByRole("button", { name: "IN 9" }))).toBe(true);
  });
});
