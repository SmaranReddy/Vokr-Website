"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
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
 * by the live catalog variants. "Add to Cart" now calls the Phase 5 cart
 * API (`useCart().addItem`) instead of staying inert.
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
    if (!selected) return;
    await addItem(selected.id, 1);
    openCart();
  }

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
          const disabled = !variant.isPurchasable;
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
              } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {displaySizeLabel(variant.sizeLabel)}
            </button>
          );
        })}
      </div>

      {/* The label is the legacy's, verbatim and unconditional. Phase 5
          needs a size before it can resolve a variant, but "Select a size"
          / "Add to Cart — IN 8" are wording changes to approved content
          (§2A.4) and break the §2A.7 text diff on all five PDPs. The
          requirement is carried by the disabled state plus an `.sr-only`
          description instead, which announces the reason without altering
          any visible string. */}
      <button
        type="button"
        disabled={!selected || isLoading}
        aria-describedby={selected ? undefined : "pdp-size-required"}
        onClick={() => void handleAddToCart()}
        className="w-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add to Cart
      </button>
      <p id="pdp-size-required" className="sr-only">
        Select a size to add this item to your cart.
      </p>
      <p className="mt-3 text-xs text-muted">
        Free shipping on orders over ₹4,999. Free 30-day exchanges &amp;
        returns.
      </p>
    </div>
  );
}
