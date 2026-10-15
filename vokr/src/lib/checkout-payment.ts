import type { CheckoutState, PaymentStatus } from "@/generated/prisma/enums";

/**
 * Browser-side payment-step logic (plan §5 Phase 7, task 5; Phase 8 Open
 * 4), kept free of React so it can be unit-tested. Nothing here decides a
 * payment: the server's verified webhooks (and reconciliation) are the only
 * writers of payment state. The browser only reads it back and says
 * honestly what it sees — "pending" stays pending.
 */

/** What the read-only `GET /api/payments/status` reports. */
export interface PaymentStatusSnapshot {
  checkoutState: CheckoutState;
  paymentStatus: PaymentStatus | null;
  /** Set once the session is paid and its order exists. */
  orderNumber?: string | null;
}

export type PaymentOutcome =
  /** Verified by the server: the session is paid. */
  | "paid"
  /** The attempt failed and the hold is still live: the customer may retry. */
  | "failed"
  /** Money reached Razorpay after the hold ended: it is refunded automatically (plan §0.3 D12). */
  | "late"
  /** The hold ended with no money taken: checkout must start again. */
  | "expired"
  /** Nothing verified yet. Never resolved optimistically. */
  | "pending";

export function outcomeFromStatus(status: PaymentStatusSnapshot): PaymentOutcome {
  if (status.checkoutState === "paid") return "paid";
  if (status.checkoutState === "expired" || status.checkoutState === "abandoned" || status.checkoutState === "failed") {
    return status.paymentStatus === "authorized" || status.paymentStatus === "captured" ? "late" : "expired";
  }
  if (status.paymentStatus === "failed") return "failed";
  return "pending";
}

/** Whole seconds left on the stock hold, never negative. */
export function secondsUntil(expiresAt: string | null, now: number = Date.now()): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Below this, the payment window is not opened: a payment started now
 * could complete after the hold lapses, and would then be refunded rather
 * than fulfilled. The server refuses an order once the hold has lapsed in
 * any case (`createPaymentOrder`).
 */
export const MIN_SECONDS_TO_START_PAYMENT = 60;
/** Razorpay Checkout closes this long before the hold lapses. */
export const CHECKOUT_TIMEOUT_MARGIN_SECONDS = 30;

/**
 * Razorpay Checkout's `timeout` (seconds), derived from the hold rather
 * than a flat value (Phase 8 Open 4), or `null` when too little time is
 * left to start a payment at all.
 */
export function checkoutTimeoutSeconds(holdSecondsLeft: number): number | null {
  if (holdSecondsLeft < MIN_SECONDS_TO_START_PAYMENT) return null;
  return holdSecondsLeft - CHECKOUT_TIMEOUT_MARGIN_SECONDS;
}

/** Poll delays after Checkout closes: quick at first, then backing off; about 3 minutes in all. */
export const STATUS_POLL_DELAYS_MS: readonly number[] = [
  ...Array<number>(10).fill(2_000),
  ...Array<number>(12).fill(5_000),
  ...Array<number>(9).fill(10_000),
];

/** The error codes the checkout and payment routes return (`src/lib/errors.ts`). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { unavailable?: { variantId: string; requested: number; available: number }[] };
  };
}

export type CheckoutProblem =
  /** Some lines are short; the bag needs changing. */
  | { kind: "out_of_stock"; message: string; lines: { variantId: string; requested: number; available: number }[] }
  /** The bag or its prices changed since pricing: re-price and review. */
  | { kind: "stale"; message: string }
  /** The hold lapsed: start checkout again. */
  | { kind: "reservation_expired"; message: string }
  | { kind: "other"; message: string };

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export function problemFromError(body: unknown): CheckoutProblem {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  const message = typeof error?.message === "string" ? error.message : GENERIC_ERROR;
  switch (error?.code) {
    case "OUT_OF_STOCK":
      return { kind: "out_of_stock", message, lines: error.details?.unavailable ?? [] };
    case "CHECKOUT_STALE":
      return { kind: "stale", message };
    case "RESERVATION_EXPIRED":
      return { kind: "reservation_expired", message };
    default:
      return { kind: "other", message };
  }
}
