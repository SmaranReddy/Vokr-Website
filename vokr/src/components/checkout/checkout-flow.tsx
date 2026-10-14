"use client";

import { useCallback, useEffect, useState } from "react";

import { formatPaiseAsRupees } from "@/lib/currency";
import { GST_STATES } from "@/lib/gst-states";
import type { CheckoutSessionView } from "@/server/checkout/service";
import type { PricingLine } from "@/server/pricing";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const IDEMPOTENCY_KEY_STORAGE_KEY = "vokr:checkout:idempotency-key";

interface ApiError {
  error: { message: string };
}

async function parseSessionResponse(
  response: Response,
): Promise<CheckoutSessionView> {
  const body = (await response.json()) as
    { checkoutSession: CheckoutSessionView } | ApiError;
  if (!response.ok) {
    throw new Error("error" in body ? body.error.message : GENERIC_ERROR);
  }
  return (body as { checkoutSession: CheckoutSessionView }).checkoutSession;
}

/** Stable across reloads and retries within one browser, per plan §5 Phase 6 task 10 — created once, reused for every `POST /api/checkout/session` from this device until checkout completes. */
function getIdempotencyKey(): string {
  const existing = window.sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(IDEMPOTENCY_KEY_STORAGE_KEY, created);
  return created;
}

type ServiceabilityState =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "serviceable";
      codEligible: boolean;
      estimatedDeliveryDays: number;
    }
  | { status: "unserviceable" }
  | { status: "error"; message: string };

function GstLine({ line }: { line: PricingLine }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border py-3 text-sm">
      <div>
        <p className="font-medium text-foreground">{line.productName}</p>
        <p className="text-xs text-muted">
          {line.colorway} · {line.sizeLabel} · Qty {line.quantity}
        </p>
        <p className="mt-1 text-xs text-muted">
          HSN {line.hsnCode} · GST {(line.gstRateBps / 100).toFixed(1)}%
          {line.igstPaise > 0
            ? ` (IGST ${formatPaiseAsRupees(line.igstPaise)})`
            : ` (CGST ${formatPaiseAsRupees(line.cgstPaise)} + SGST ${formatPaiseAsRupees(line.sgstPaise)})`}
        </p>
      </div>
      <p className="shrink-0 font-medium text-foreground">
        {formatPaiseAsRupees(line.lineSubtotalPaise)}
      </p>
    </li>
  );
}

export function CheckoutFlow() {
  const [session, setSession] = useState<CheckoutSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [pincode, setPincode] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<"prepaid" | "cod">(
    "prepaid",
  );
  const [serviceability, setServiceability] = useState<ServiceabilityState>({
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: getIdempotencyKey() }),
    })
      .then(parseSessionResponse)
      .then((next) => {
        if (!cancelled) {
          setSession(next);
          if (next.address) {
            setName(next.address.name);
            setPhone(next.address.phone);
            setLine1(next.address.line1);
            setLine2(next.address.line2 ?? "");
            setCity(next.address.city);
            setAddressState(next.address.state);
            setPincode(next.address.pincode);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : GENERIC_ERROR);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const checkServiceability = useCallback(async (pin: string) => {
    setServiceability({ status: "checking" });
    try {
      const response = await fetch(
        `/api/shipping/serviceability?pincode=${encodeURIComponent(pin)}`,
      );
      const body = (await response.json()) as
        | {
            serviceable: true;
            codEligible: boolean;
            estimatedDeliveryDays: number;
          }
        | { serviceable: false }
        | ApiError;
      if (!response.ok) {
        throw new Error("error" in body ? body.error.message : GENERIC_ERROR);
      }
      if ("error" in body) {
        throw new Error(body.error.message);
      }
      if (body.serviceable) {
        setServiceability({
          status: "serviceable",
          codEligible: body.codEligible,
          estimatedDeliveryDays: body.estimatedDeliveryDays,
        });
      } else {
        setServiceability({ status: "unserviceable" });
      }
    } catch (err) {
      setServiceability({
        status: "error",
        message: err instanceof Error ? err.message : GENERIC_ERROR,
      });
    }
  }, []);

  const submitAddress = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!session) return;
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/checkout/session/${session.id}/address`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              phone,
              line1,
              line2: line2 || undefined,
              city,
              state: addressState,
              pincode,
            }),
          },
        );
        const next = await parseSessionResponse(response);
        setSession(next);
        await checkServiceability(pincode);
      } catch (err) {
        setError(err instanceof Error ? err.message : GENERIC_ERROR);
      } finally {
        setIsLoading(false);
      }
    },
    [
      session,
      name,
      phone,
      line1,
      line2,
      city,
      addressState,
      pincode,
      checkServiceability,
    ],
  );

  const computePricing = useCallback(
    async (method: "prepaid" | "cod") => {
      if (!session) return;
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/checkout/session/${session.id}/pricing?paymentMethod=${method}`,
        );
        setSession(await parseSessionResponse(response));
      } catch (err) {
        setError(err instanceof Error ? err.message : GENERIC_ERROR);
      } finally {
        setIsLoading(false);
      }
    },
    [session],
  );

  const onSelectPaymentMethod = useCallback(
    (method: "prepaid" | "cod") => {
      setPaymentMethod(method);
      void computePricing(method);
    },
    [computePricing],
  );

  if (isLoading && !session) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 text-sm text-muted">
        Loading checkout…
      </main>
    );
  }

  const snapshot = session?.pricingSnapshot ?? null;
  const codBlockedByServiceability =
    serviceability.status === "serviceable" && !serviceability.codEligible;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-xl font-semibold text-foreground">Checkout</h1>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">
          1. Shipping address
        </h2>
        <form
          onSubmit={submitAddress}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input
            required
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            required
            placeholder="Phone (10-digit mobile)"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            required
            placeholder="Address line 1"
            value={line1}
            onChange={(event) => setLine1(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            placeholder="Address line 2 (optional)"
            value={line2}
            onChange={(event) => setLine2(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            required
            placeholder="City"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm"
          />
          <select
            required
            value={addressState}
            onChange={(event) => setAddressState(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm"
          >
            <option value="">State</option>
            {GST_STATES.map((state) => (
              <option key={state.code} value={state.name}>
                {state.name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="PIN code"
            value={pincode}
            onChange={(event) => setPincode(event.target.value)}
            className="border border-border-strong px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !session}
            className="bg-foreground px-6 py-3 text-sm font-semibold text-background disabled:opacity-50 sm:col-span-2"
          >
            Save address
          </button>
        </form>

        {serviceability.status === "checking" && (
          <p className="mt-3 text-xs text-muted">
            Checking delivery to this PIN code…
          </p>
        )}
        {serviceability.status === "serviceable" && (
          <p className="mt-3 text-xs text-muted">
            Delivers in ~{serviceability.estimatedDeliveryDays} days.
            {serviceability.codEligible
              ? " COD available."
              : " Prepaid only for this PIN code."}
          </p>
        )}
        {serviceability.status === "unserviceable" && (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600">
            We currently can&apos;t deliver to this PIN code.
          </p>
        )}
      </section>

      {session?.address && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            2. Payment method
          </h2>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => onSelectPaymentMethod("prepaid")}
              className={`border px-4 py-2 text-sm ${paymentMethod === "prepaid" ? "border-foreground font-semibold" : "border-border-strong"}`}
            >
              Prepaid
            </button>
            <button
              type="button"
              disabled={codBlockedByServiceability}
              onClick={() => onSelectPaymentMethod("cod")}
              className={`border px-4 py-2 text-sm disabled:opacity-40 ${paymentMethod === "cod" ? "border-foreground font-semibold" : "border-border-strong"}`}
              title={
                codBlockedByServiceability
                  ? "COD is not available for this PIN code"
                  : undefined
              }
            >
              Cash on Delivery
            </button>
          </div>
        </section>
      )}

      {snapshot && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            3. Review order
          </h2>
          <ul className="mt-4">
            {snapshot.lines.map((line) => (
              <GstLine key={line.variantId} line={line} />
            ))}
          </ul>

          <div className="mt-4 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Subtotal (GST-inclusive)</span>
              <span>{formatPaiseAsRupees(snapshot.subtotalPaise)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Included GST</span>
              <span>{formatPaiseAsRupees(snapshot.taxPaise)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Shipping</span>
              <span>
                {snapshot.shippingPaise === 0
                  ? "Free"
                  : formatPaiseAsRupees(snapshot.shippingPaise)}
              </span>
            </div>
            {snapshot.codFeePaise > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted">COD handling fee</span>
                <span>{formatPaiseAsRupees(snapshot.codFeePaise)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Total</span>
              <span>{formatPaiseAsRupees(snapshot.totalPaise)}</span>
            </div>
          </div>

          <button
            type="button"
            aria-disabled="true"
            title="Payment launches in Phase 7"
            disabled
            className="mt-6 w-full cursor-default bg-foreground px-6 py-3.5 text-sm font-semibold text-background opacity-70"
          >
            Continue to payment
          </button>
        </section>
      )}
    </main>
  );
}
