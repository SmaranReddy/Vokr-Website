"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkoutTimeoutSeconds,
  formatCountdown,
  GENERIC_ERROR,
  outcomeFromStatus,
  problemFromError,
  secondsUntil,
  STATUS_POLL_DELAYS_MS,
  type PaymentOutcome,
  type PaymentStatusSnapshot,
} from "@/lib/checkout-payment";
import { formatPaiseAsRupees } from "@/lib/currency";
import { loadRazorpayCheckout } from "@/lib/razorpay-checkout";
import type { CheckoutSessionView } from "@/server/checkout/service";

type Phase =
  /** Hold is live; the customer can start (or retry) a payment. */
  | "ready"
  /** Asking the server for the Razorpay order and loading Checkout. */
  | "opening"
  /** Razorpay Checkout is open. */
  | "in_checkout"
  /** Reading the server's verified status. */
  | "verifying"
  | PaymentOutcome;

interface OrderResponse {
  order: { razorpayOrderId: string; amountPaise: number; currency: string };
  keyId: string;
}

async function readStatus(checkoutSessionId: string): Promise<PaymentStatusSnapshot> {
  const response = await fetch(`/api/payments/status?checkoutSessionId=${encodeURIComponent(checkoutSessionId)}`, {
    cache: "no-store",
  });
  const body = (await response.json()) as { payment: PaymentStatusSnapshot } | unknown;
  if (!response.ok) throw new Error(problemFromError(body).message);
  return (body as { payment: PaymentStatusSnapshot }).payment;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The prepaid payment step (plan Â§5 Phase 7, task 5 and UI Impact; Phase 8
 * Open 4). The session arrives already `reserved` (or `payment_pending`),
 * so its `expiresAt` is the stock hold's expiry.
 *
 * Razorpay Checkout's success handler is treated as untrusted: it only
 * starts reading `GET /api/payments/status`, which reports what verified
 * webhooks and reconciliation recorded. Nothing the browser does here can
 * mark anything paid, and an unconfirmed payment is shown as pending, never
 * as success.
 */
export function PaymentStep({
  session,
  onRestart,
  onPaid,
}: {
  session: CheckoutSessionView;
  onRestart: () => void;
  onPaid: () => void;
}) {
  const [storedPhase, setPhase] = useState<Phase>(() =>
    session.state === "paid" ? "paid" : session.state === "payment_pending" ? "verifying" : "ready",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(session.expiresAt));
  const pollRun = useRef(0);
  const total = session.pricingSnapshot?.totalPaise ?? 0;

  const settle = useCallback(
    (outcome: PaymentOutcome) => {
      setPhase(outcome);
      if (outcome === "paid") onPaid();
    },
    [onPaid],
  );

  /** Reads the verified status until it is final, or gives up honestly as `pending`. */
  const poll = useCallback(
    async (delays: readonly number[] = STATUS_POLL_DELAYS_MS) => {
      const run = ++pollRun.current;
      for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        if (run !== pollRun.current) return;
        try {
          const outcome = outcomeFromStatus(await readStatus(session.id));
          if (run !== pollRun.current) return;
          if (outcome !== "pending") {
            settle(outcome);
            return;
          }
        } catch {
          // A failed read is not an outcome; keep reading.
        }
        if (attempt < delays.length) await sleep(delays[attempt] ?? 0);
      }
      if (run === pollRun.current) setPhase("pending");
    },
    [session.id, settle],
  );

  const verify = useCallback(() => {
    setPhase("verifying");
    setMessage(null);
    void poll();
  }, [poll]);

  // Stop polling when the step goes away.
  useEffect(() => () => void (pollRun.current += 1), []);

  // A reload mid-payment resumes by reading the status, never by assuming.
  useEffect(() => {
    // poll() sets state only after an awaited status read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session.state === "payment_pending") void poll();
    // Only on mount: later reads are driven by the customer's actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setSecondsLeft(secondsUntil(session.expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [session.expiresAt]);

  // The hold lapsed before a payment started: nothing was taken.
  const phase: Phase = storedPhase === "ready" && secondsLeft === 0 ? "expired" : storedPhase;

  const pay = useCallback(async () => {
    const timeout = checkoutTimeoutSeconds(secondsUntil(session.expiresAt));
    if (timeout === null) {
      setPhase("expired");
      return;
    }
    setPhase("opening");
    setMessage(null);

    let order: OrderResponse;
    try {
      const response = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkoutSessionId: session.id }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const problem = problemFromError(body);
        if (problem.kind === "reservation_expired") {
          setPhase("expired");
          return;
        }
        setMessage(problem.message);
        setPhase("ready");
        return;
      }
      order = body as OrderResponse;
    } catch {
      setMessage(GENERIC_ERROR);
      setPhase("ready");
      return;
    }

    let Razorpay;
    try {
      Razorpay = await loadRazorpayCheckout();
    } catch {
      setMessage("The payment window could not be loaded. Check your connection and try again.");
      setPhase("ready");
      return;
    }

    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.order.razorpayOrderId,
      amount: order.order.amountPaise,
      currency: order.order.currency,
      name: "Vokr",
      description: "Vokr order",
      timeout,
      prefill: { name: session.address?.name, contact: session.address?.phone },
      // Untrusted: it only starts reading the verified status.
      handler: verify,
      modal: {
        confirm_close: true,
        // Closed without a success callback: a UPI or bank payment may
        // still be completing, so look once before offering a retry.
        ondismiss: () => {
          void (async () => {
            try {
              const outcome = outcomeFromStatus(await readStatus(session.id));
              if (outcome !== "pending") {
                settle(outcome);
                return;
              }
            } catch {
              // Fall through to the retry offer.
            }
            setMessage(
              "The payment window was closed. If you completed a payment, it will show here once it is confirmed â€” please don't pay twice.",
            );
            setPhase("ready");
          })();
        },
      },
    });
    setPhase("in_checkout");
    checkout.open();
  }, [session.expiresAt, session.id, session.address, settle, verify]);

  return (
    <section className="mt-8" aria-labelledby="payment-step-heading">
      <h2 id="payment-step-heading" className="text-sm font-semibold text-foreground">
        4. Payment
      </h2>

      <div role="status" aria-live="polite" className="mt-4 text-sm">
        {(phase === "ready" || phase === "opening" || phase === "in_checkout") && (
          <p className="text-muted">
            Your items are held for <span className="font-semibold text-foreground">{formatCountdown(secondsLeft)}</span>.
          </p>
        )}
        {phase === "verifying" && (
          <p className="text-foreground">Confirming your paymentâ€¦ Please keep this page open and don&apos;t pay again.</p>
        )}
        {phase === "paid" && (
          <div>
            <p className="text-base font-semibold text-foreground">Payment confirmed</p>
            <p className="mt-1 text-muted">
              We&apos;ve received {formatPaiseAsRupees(total)}. Your checkout reference is{" "}
              <span className="font-mono text-foreground">{session.id.slice(0, 8).toUpperCase()}</span>.
            </p>
          </div>
        )}
        {phase === "failed" && (
          <p className="font-medium text-red-600">
            Your payment didn&apos;t go through. You can try again while your items are held.
          </p>
        )}
        {phase === "late" && (
          <div>
            <p className="font-medium text-foreground">Your payment arrived after your reservation ended.</p>
            <p className="mt-1 text-muted">
              We couldn&apos;t hold your items, so the full amount will be refunded automatically to your original
              payment method. You don&apos;t need to do anything.
            </p>
          </div>
        )}
        {phase === "expired" && (
          <p className="font-medium text-foreground">Your reservation has lapsed. Please start checkout again.</p>
        )}
        {phase === "pending" && (
          <div>
            <p className="font-medium text-foreground">We haven&apos;t received confirmation of your payment yet.</p>
            <p className="mt-1 text-muted">
              Some UPI and bank payments take a few minutes. Please don&apos;t pay again â€” check back shortly.
            </p>
          </div>
        )}
      </div>

      {message && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {message}
        </p>
      )}

      {(phase === "ready" || phase === "opening" || phase === "in_checkout" || phase === "failed") && (
        <button
          type="button"
          onClick={() => void pay()}
          disabled={phase !== "ready" && phase !== "failed"}
          className="mt-6 w-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {phase === "opening" ? "Opening paymentâ€¦" : phase === "failed" ? "Try again" : `Pay ${formatPaiseAsRupees(total)}`}
        </button>
      )}
      {phase === "pending" && (
        <button
          type="button"
          onClick={verify}
          className="mt-6 w-full border border-foreground px-6 py-3.5 text-sm font-semibold text-foreground"
        >
          Check again
        </button>
      )}
      {(phase === "expired" || phase === "late") && (
        <button
          type="button"
          onClick={onRestart}
          className="mt-6 w-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background"
        >
          Start checkout again
        </button>
      )}
    </section>
  );
}
