"use client";

import Link from "next/link";
import { useState } from "react";
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
 * by the live catalog variants, but "Add to Cart" stays inert: cart UI is
 * explicitly out of scope for this phase (Phases 5–7 own it). Matches the
 * header's cart affordance treatment — present, honest about why it
 * doesn't yet do anything, not a silent no-op.
 */
export function PdpPurchasePanel({
  variants,
}: {
  variants: CatalogVariant[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = variants.find((variant) => variant.id === selectedId);

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

      <button
        type="button"
        aria-disabled="true"
        title="Cart launches in a later phase"
        className="w-full cursor-default bg-foreground px-6 py-3.5 text-sm font-semibold text-background opacity-70"
      >
        {selected ? `Add to Cart — ${selected.sizeLabel}` : "Add to Cart"}
      </button>
      <p className="mt-3 text-xs text-muted">
        Free shipping on orders over ₹4,999. Free 30-day exchanges &amp;
        returns.
      </p>
    </div>
  );
}
