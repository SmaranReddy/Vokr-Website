"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import {
  ORDERING_ENABLED,
  ORDERING_UNAVAILABLE_MESSAGE,
} from "@/config/commerce";
import type { CatalogVariant } from "@/server/catalog";

/**
 * The legacy always displays `IN <size>` (`IN 4`, `IN S/M`, `IN One
 * Size`). The seed data only bakes that prefix into the adult/kids shoe
 * sizes (`sizeLabel: "IN 4"`); socks and laces store the bare value
 * (`"S/M"`, `"One Size"`) — see `prisma/seed-data.ts`. Normalising here
 * keeps the display faithful without duplicating "IN " for the sizes
 * that already have it.
 */
function displaySizeLabel(sizeLabel: string): string {
  return sizeLabel.startsWith("IN ") ? sizeLabel : `IN ${sizeLabel}`;
}

/**
 * The legacy `.pdp-size-grid` / `#pdpAddBtn` — real size selection driven
 * by the live catalog variants. "Add to Cart" calls the Phase 5 cart
 * API (`useCart().addItem`) — but only once `ORDERING_ENABLED` is on.
 * Until checkout and payment ship, the button is disabled and a visible
 * notice (wired via `aria-describedby`) says ordering isn't available,
 * whatever the variants' status or stock (§2A.6 row L1).
 */
export function PdpPurchasePanel({
  variants,
}: {
  variants: CatalogVariant[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { addItem, openCart, isLoading } = useCart();
  const selected = variants.find((variant) => variant.id === selectedId);

  // Opens the drawer either way: on success it shows the item just added,
  // on failure it surfaces `CartProvider`'s own error banner — one place
  // for that message rather than a second copy here.
  async function handleAddToCart() {
    if (!ORDERING_ENABLED || !selected) return;
    await addItem(selected.id, 1);
    openCart();
  }

  const canAdd = ORDERING_ENABLED && Boolean(selected) && !isLoading;
  const describedBy = !ORDERING_ENABLED
    ? "pdp-ordering-unavailable"
    : selected
      ? undefined
      : "pdp-size-required";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Select Size (IN/UK)</span>
        <Link href="/#fit-quiz" className="text-[13px] font-semibold">
          Find Your Fit &rarr;
        </Link>
      </div>
      <div className="mb-6 grid grid-cols-4 gap-2">
        {variants.map((variant) => {
          const isSelected = variant.id === selectedId;
          // A size with nothing left to sell (stock net of live holds) is
          // shown but cannot be chosen. Struck through for sighted users;
          // the reason is in the button's accessible name, not a tooltip.
          const soldOut = variant.isPurchasable && variant.quantityAvailable <= 0;
          const disabled = !variant.isPurchasable || soldOut;
          return (
            <button
              key={variant.id}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => setSelectedId(variant.id)}
              className={`border py-2.5 text-sm font-medium transition-colors ${
                isSelected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-strong text-foreground hover:border-foreground"
              } ${disabled ? "cursor-not-allowed opacity-40" : ""} ${soldOut ? "line-through" : ""}`}
            >
              {displaySizeLabel(variant.sizeLabel)}
              {soldOut && <span className="sr-only">, sold out</span>}
            </button>
          );
        })}
      </div>

      {/* The label is the legacy's, verbatim and unconditional (§2A.4,
          §2A.7). Why it is disabled is carried by `aria-describedby`: the
          visible ordering notice while ordering is off (§2A.6 row L1),
          otherwise the `.sr-only` size requirement. */}
      <button
        type="button"
        disabled={!canAdd}
        aria-describedby={describedBy}
        onClick={() => void handleAddToCart()}
        className="w-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add to Cart
      </button>
      {ORDERING_ENABLED ? (
        <p id="pdp-size-required" className="sr-only">
          Select a size to add this item to your cart.
        </p>
      ) : (
        <p
          id="pdp-ordering-unavailable"
          role="note"
          className="mt-3 border border-border-strong bg-surface-2 px-4 py-3 text-sm font-medium text-foreground"
        >
          {ORDERING_UNAVAILABLE_MESSAGE}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Shipping calculated at checkout. Free 30-day exchanges &amp;
        returns.
      </p>
    </div>
  );
}
