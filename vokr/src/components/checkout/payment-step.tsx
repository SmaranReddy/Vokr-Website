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
  /** One read of the verified status (after a reload or a closed window). */
  | "checking"
  /** Checkout reported success: reading the verified status until it is final. */
  | "verifying"
  | PaymentOutcome;

interface OrderResponse {
  order: { razorpayOrderId: string; amountPaise: number; currency: string };
  keyId: string;
}

const DONT_PAY_TWICE =
  "If you completed a payment, it will show here once it is confirmed — please don't pay twice.";

/** Survives a reload: once Checkout said "success" for this session, Pay is never offered again. */
const successKey = (sessionId: string) => `vokr:checkout:success-seen:${sessionId}`;

function readSuccessSeen(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(successKey(sessionId)) === "1";
  } catch {
    return false;
  }
}

function rememberSuccessSeen(sessionId: string): void {
  try {
    window.sessionStorage.setItem(successKey(sessionId), "1");
  } catch {
    // Storage unavailable: the in-memory guard still holds for this page.
  }
}

async function readStatus(checkoutSessionId: string): Promise<PaymentStatusSnapshot> {
  const response = await fetch(`/api/payments/status?checkoutSessionId=${encodeURIComponent(checkoutSessionId)}`, {
    cache: "no-store",
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(problemFromError(body).message);
  return (body as { payment: PaymentStatusSnapshot }).payment;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The prepaid payment step (plan §5 Phase 7, task 5 and UI Impact; Phase 8
 * Open 4). The session arrives already `reserved` (or `payment_pending`),
 * so its `expiresAt` is the stock hold's expiry.
 *
 * Razorpay Checkout's success handler is treated as untrusted: it only
 * starts reading `GET /api/payments/status`, which reports what verified
 * webhooks and reconciliation recorded. Nothing the browser does here can
 * mark anything paid, and an unconfirmed payment is shown as pending, never
 * as success.
 *
 * Two rules keep a customer from paying twice:
 * - once Checkout reported success, Pay is never offered again for this
 *   session (even after a reload), and a `failed` reading is treated as an
 *   earlier attempt, not the last word — a retry inside Checkout can
 *   succeed after one failed;
 * - without that, Pay comes back only when the server shows no attempt
 *   with money in flight, and always with a don't-pay-twice warning.
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
  const [initialSuccessSeen] = useState(() => readSuccessSeen(session.id));
  const [storedPhase, setStoredPhase] = useState<Phase>(() => {
    if (session.state === "paid") return "paid";
    if (session.state === "payment_pending") return initialSuccessSeen ? "verifying" : "checking";
    return "ready";
  });
  const [message, setMessage] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(session.expiresAt));
  const phaseRef = useRef<Phase>(storedPhase);
  const successSeen = useRef(initialSuccessSeen);
  const readRun = useRef(0);
  const total = session.pricingSnapshot?.totalPaise ?? 0;

  /** Every status read also picks up the order number once the order exists. */
  const read = useCallback(async () => {
    const status = await readStatus(session.id);
    if (status.orderNumber) setOrderNumber(status.orderNumber);
    return status;
  }, [session.id]);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setStoredPhase(next);
  }, []);

  const settle = useCallback(
    (outcome: PaymentOutcome) => {
      setPhase(outcome);
      if (outcome === "paid") onPaid();
    },
    [onPaid, setPhase],
  );

  /** After a success callback: reads until final, or gives up honestly as `pending`. */
  const poll = useCallback(async () => {
    const run = ++readRun.current;
    const delays = STATUS_POLL_DELAYS_MS;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      if (run !== readRun.current) return;
      try {
        const outcome = outcomeFromStatus(await read());
        if (run !== readRun.current) return;
        // `failed` may be an earlier attempt; the one Checkout called a success may still land.
        if (outcome !== "pending" && outcome !== "failed") {
          settle(outcome);
          return;
        }
      } catch {
        // A failed read is not an outcome; keep reading.
      }
      if (attempt < delays.length) await sleep(delays[attempt] ?? 0);
    }
    if (run === readRun.current) setPhase("pending");
  }, [read, settle, setPhase]);

  /**
   * One read, when there was no success callback to go on: a reload, a
   * closed window, the hold running out with Checkout open, "Check again".
   */
  const checkOnce = useCallback(async () => {
    if (successSeen.current) {
      await poll();
      return;
    }
    const run = ++readRun.current;
    let status: PaymentStatusSnapshot | null = null;
    try {
      status = await read();
    } catch {
      // Unknown is never treated as "nothing happened".
    }
    if (run !== readRun.current) return;
    if (!status) {
      setMessage(DONT_PAY_TWICE);
      setPhase("pending");
      return;
    }
    const outcome = outcomeFromStatus(status);
    if (outcome !== "pending") {
      settle(outcome);
      return;
    }
    if (status.paymentStatus === "authorized") {
      // Money is in flight; wait for it rather than offer another payment.
      setPhase("verifying");
      await poll();
      return;
    }
    // No attempt with money in flight: Pay comes back, with a warning.
    setMessage(DONT_PAY_TWICE);
    setPhase("ready");
  }, [read, settle, setPhase, poll]);

  const onSuccessCallback = useCallback(() => {
    successSeen.current = true;
    rememberSuccessSeen(session.id);
    setMessage(null);
    setPhase("verifying");
    void poll();
  }, [session.id, setPhase, poll]);

  // Stop reading when the step goes away.
  useEffect(() => () => void (readRun.current += 1), []);

  // A reload mid-payment resumes by reading the status, never by assuming.
  useEffect(() => {
    if (session.state === "paid") {
      // Only to show the order number; the outcome is already known. Sets state after the awaited read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      read().catch(() => undefined);
      return;
    }
    if (session.state !== "payment_pending") return;
    // Both set state only after an awaited status read.
    if (successSeen.current) void poll();
    else void checkOnce();
    // Only on mount: later reads are driven by the customer's actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const left = secondsUntil(session.expiresAt);
      setSecondsLeft(left);
      // Checkout may close itself at its timeout without telling us; look rather than sit.
      if (left === 0 && phaseRef.current === "in_checkout" && !successSeen.current) {
        setPhase("checking");
        void checkOnce();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session.expiresAt, setPhase, checkOnce]);

  // The hold lapsed before a payment started: nothing was taken.
  const phase: Phase = storedPhase === "ready" && secondsLeft === 0 ? "expired" : storedPhase;

  const pay = useCallback(async () => {
    if (successSeen.current) return;
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
      handler: onSuccessCallback,
      modal: {
        confirm_close: true,
        // Closed without a success callback (or after one — then ignored):
        // a UPI or bank payment may still be completing, so look first.
        ondismiss: () => {
          if (successSeen.current) return;
          setPhase("checking");
          void checkOnce();
        },
      },
    });
    setPhase("in_checkout");
    checkout.open();
  }, [session.expiresAt, session.id, session.address, setPhase, onSuccessCallback, checkOnce]);

  const holdVisible = phase === "ready" || phase === "opening" || phase === "in_checkout";

  return (
    <section className="mt-8" aria-labelledby="payment-step-heading">
      <h2 id="payment-step-heading" className="text-sm font-semibold text-foreground">
        4. Payment
      </h2>

      {/* Outside the live region: a ticking timer must not be announced every second. */}
      {holdVisible && (
        <p className="mt-4 text-sm text-muted">
          Your items are held for <span className="font-semibold text-foreground">{formatCountdown(secondsLeft)}</span>.
        </p>
      )}

      <div role="status" aria-live="polite" className="mt-4 text-sm">
        {phase === "checking" && <p className="text-foreground">Checking your payment…</p>}
        {phase === "verifying" && (
          <p className="text-foreground">Confirming your payment… Please keep this page open and don&apos;t pay again.</p>
        )}
        {phase === "paid" && (
          <div>
            <p className="text-base font-semibold text-foreground">Payment confirmed</p>
            <p className="mt-1 text-muted">
              We&apos;ve received {formatPaiseAsRupees(total)}.{" "}
              {orderNumber ? (
                <>
                  Your order number is <span className="font-mono font-semibold text-foreground">{orderNumber}</span>.
                </>
              ) : (
                <>
                  Your checkout reference is{" "}
                  <span className="font-mono text-foreground">{session.id.slice(0, 8).toUpperCase()}</span>.
                </>
              )}
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
          <div>
            <p className="font-medium text-foreground">Your reservation has lapsed. Please start checkout again.</p>
            <p className="mt-1 text-muted">
              If a payment completed after it lapsed, the full amount will be refunded automatically.
            </p>
          </div>
        )}
        {phase === "pending" && (
          <div>
            <p className="font-medium text-foreground">We haven&apos;t received confirmation of your payment yet.</p>
            <p className="mt-1 text-muted">
              Some UPI and bank payments take a few minutes. Please don&apos;t pay again — check back shortly.
            </p>
          </div>
        )}
      </div>

      {message && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {message}
        </p>
      )}

      {(holdVisible || phase === "failed") && (
        <button
          type="button"
          onClick={() => void pay()}
          disabled={phase !== "ready" && phase !== "failed"}
          className="mt-6 w-full bg-foreground px-6 py-3.5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {phase === "opening" ? "Opening payment…" : phase === "failed" ? "Try again" : `Pay ${formatPaiseAsRupees(total)}`}
        </button>
      )}
      {phase === "pending" && (
        <button
          type="button"
          onClick={() => {
            setPhase("checking");
            void checkOnce();
          }}
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
