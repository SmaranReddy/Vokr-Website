/**
 * Razorpay Checkout (the browser modal), loaded on demand from Razorpay's
 * own origin only when a customer starts paying. Its success handler is
 * untrusted input (plan §5 Phase 7, task 5): the payment step never sends
 * the handler's payment ID or signature anywhere — it only starts reading
 * the server's verified status.
 */

export const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  /** Seconds before Checkout closes itself. */
  timeout?: number;
  prefill?: { name?: string; contact?: string };
  handler: () => void;
  modal: { ondismiss: () => void; confirm_close?: boolean };
}

export interface RazorpayCheckoutInstance {
  open(): void;
  on(event: "payment.failed", callback: () => void): void;
}

export type RazorpayCheckoutConstructor = new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutConstructor;
  }
}

let loading: Promise<RazorpayCheckoutConstructor> | null = null;

/** Injects Razorpay's script once; a failed load can be retried. */
export function loadRazorpayCheckout(): Promise<RazorpayCheckoutConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Razorpay Checkout needs a browser."));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayCheckoutConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay Checkout did not load."));
    };
    script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
