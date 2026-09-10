"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CartView } from "@/server/cart";

const EMPTY_CART: CartView = {
  cartId: null,
  items: [],
  subtotalPaise: 0,
  taxPaise: 0,
  totalPaise: 0,
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

interface CartApiSuccess {
  cart: CartView;
}
interface CartApiError {
  error: { message: string };
}

async function parseCartResponse(response: Response): Promise<CartView> {
  const body = (await response.json()) as CartApiSuccess | CartApiError;
  if (!response.ok) {
    const message = "error" in body ? body.error.message : GENERIC_ERROR_MESSAGE;
    throw new Error(message);
  }
  return (body as CartApiSuccess).cart;
}

interface CartContextValue {
  cart: CartView;
  /** Sum of every line's quantity, available or not — "how many things are in the bag." */
  itemCount: number;
  isLoading: boolean;
  isOpen: boolean;
  error: string | null;
  openCart: () => void;
  closeCart: () => void;
  addItem: (variantId: string, quantity?: number) => Promise<void>;
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>;
  removeItem: (cartItemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

/** Wraps the app (root layout) so the header's bag count, the PDP's Add to Cart, and the drawer all share one client-side cart state. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartView>(EMPTY_CART);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cart")
      .then(parseCartResponse)
      .then((next) => {
        if (!cancelled) setCart(next);
      })
      .catch(() => {
        // A failed background load on mount keeps the empty starting cart
        // rather than surfacing an error the customer didn't cause.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<Response>) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await action();
      setCart(await parseCartResponse(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : GENERIC_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addItem = useCallback(
    (variantId: string, quantity = 1) =>
      run(() =>
        fetch("/api/cart/items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ variantId, quantity }),
        }),
      ),
    [run],
  );

  const updateQuantity = useCallback(
    (cartItemId: string, quantity: number) =>
      run(() =>
        fetch(`/api/cart/items/${cartItemId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quantity }),
        }),
      ),
    [run],
  );

  const removeItem = useCallback(
    (cartItemId: string) =>
      run(() => fetch(`/api/cart/items/${cartItemId}`, { method: "DELETE" })),
    [run],
  );

  const clearCart = useCallback(
    () => run(() => fetch("/api/cart", { method: "DELETE" })),
    [run],
  );

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);

  const itemCount = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart.items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      itemCount,
      isLoading,
      isOpen,
      error,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
    }),
    [
      cart,
      itemCount,
      isLoading,
      isOpen,
      error,
      openCart,
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider.");
  }
  return context;
}
