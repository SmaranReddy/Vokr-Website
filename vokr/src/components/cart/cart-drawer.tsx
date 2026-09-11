"use client";

import { useEffect } from "react";

import { formatPaiseAsRupees } from "@/lib/currency";
import { MAX_CART_ITEM_QUANTITY, MIN_CART_ITEM_QUANTITY } from "@/lib/cart";
import type { CartLine } from "@/server/cart";

import { useCart } from "./cart-provider";

function CartLineRow({ line }: { line: CartLine }) {
  const { updateQuantity, removeItem, isLoading } = useCart();

  if (!line.available) {
    return (
      <li className="flex items-start justify-between gap-4 border-b border-border py-4">
        <div>
          <p className="text-sm font-medium text-foreground">No longer available</p>
          <p className="mt-1 text-xs text-muted">This item was removed from the catalog.</p>
        </div>
        <button
          type="button"
          onClick={() => void removeItem(line.cartItemId)}
          disabled={isLoading}
          className="text-xs font-semibold text-muted underline underline-offset-2 disabled:opacity-50"
        >
          Remove
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-4 border-b border-border py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{line.productName}</p>
        <p className="mt-0.5 text-xs text-muted">
          {line.colorway} · {line.sizeLabel}
        </p>
        {!line.inStock && (
          <p className="mt-1 text-xs font-semibold text-red-600">
            Only {line.quantityAvailable} left in stock
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease quantity"
            disabled={isLoading || line.quantity <= MIN_CART_ITEM_QUANTITY}
            onClick={() => void updateQuantity(line.cartItemId, line.quantity - 1)}
            className="h-7 w-7 border border-border-strong text-sm disabled:opacity-40"
          >
            &minus;
          </button>
          <span className="w-6 text-center text-sm">{line.quantity}</span>
          <button
            type="button"
            aria-label="Increase quantity"
            disabled={isLoading || line.quantity >= MAX_CART_ITEM_QUANTITY}
            onClick={() => void updateQuantity(line.cartItemId, line.quantity + 1)}
            className="h-7 w-7 border border-border-strong text-sm disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => void removeItem(line.cartItemId)}
            disabled={isLoading}
            className="ml-2 text-xs font-semibold text-muted underline underline-offset-2 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      <p className="shrink-0 text-sm font-medium text-foreground">
        {formatPaiseAsRupees(line.lineSubtotalPaise)}
      </p>
    </li>
  );
}

export function CartDrawer() {
  const { cart, isOpen, closeCart, error, isLoading } = useCart();

  // Escape-to-close, matching every other overlay in this codebase's
  // interaction model.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeCart();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeCart]);

  return (
    // `inert` while closed, not just `aria-hidden`: the drawer stays mounted
    // so it can transition, and its close/quantity/remove buttons stay in the
    // tab order otherwise — an `aria-hidden` subtree containing focusable
    // elements is a serious axe violation (`aria-hidden-focus`), and because
    // the drawer lives in the root layout it failed that check on every
    // route, not just the ones with a cart.
    <div
      inert={!isOpen}
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 ${isOpen ? "" : "pointer-events-none"}`}
    >
      <button
        type="button"
        aria-label="Close cart"
        onClick={closeCart}
        className={`absolute inset-0 bg-black/40 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        tabIndex={isOpen ? 0 : -1}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your Cart"
        className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col bg-background shadow-xl transition-transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Your Cart</h2>
          <button type="button" onClick={closeCart} aria-label="Close" className="p-1 text-lg leading-none">
            &times;
          </button>
        </div>

        {error && (
          <p role="alert" className="mx-5 mt-3 text-xs font-medium text-red-600">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5">
          {cart.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Your bag is empty.</p>
          ) : (
            <ul>
              {cart.items.map((line) => (
                <CartLineRow key={line.cartItemId} line={line} />
              ))}
            </ul>
          )}
        </div>

        {cart.items.length > 0 && (
          <div className="border-t border-border px-5 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium">{formatPaiseAsRupees(cart.subtotalPaise)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Includes {formatPaiseAsRupees(cart.taxPaise)} GST.
            </p>
            <div className="mt-2 flex items-center justify-between text-sm font-semibold">
              <span>Estimated Total</span>
              <span>{formatPaiseAsRupees(cart.totalPaise)}</span>
            </div>

            {/* `.cart-shipping-note` — approved legacy copy, restored verbatim. The
                GST line above it is additional detail Phase 5 can now show,
                not a replacement: shipping is still resolved at checkout. */}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Free shipping on orders over &#8377;4,999. Taxes and final
              shipping calculated at checkout.
            </p>

            <button
              type="button"
              aria-disabled="true"
              title="Checkout launches in a later phase"
              disabled={isLoading}
              className="mt-4 w-full cursor-default bg-foreground px-6 py-3.5 text-sm font-semibold text-background opacity-70"
            >
              Checkout
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
