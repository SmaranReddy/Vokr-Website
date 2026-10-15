import { describe, expect, it } from "vitest";

import {
  CHECKOUT_TIMEOUT_MARGIN_SECONDS,
  checkoutTimeoutSeconds,
  formatCountdown,
  MIN_SECONDS_TO_START_PAYMENT,
  outcomeFromStatus,
  problemFromError,
  secondsUntil,
  STATUS_POLL_DELAYS_MS,
} from "../checkout-payment";

describe("outcomeFromStatus — the browser only reports what the server verified", () => {
  it.each([
    ["paid", "captured", "paid"],
    ["payment_pending", null, "pending"],
    ["payment_pending", "created", "pending"],
    ["payment_pending", "authorized", "pending"],
    // A capture the webhook recorded but that has not (yet) paid the session is not success.
    ["payment_pending", "captured", "pending"],
    ["payment_pending", "failed", "failed"],
    ["reserved", null, "pending"],
    ["expired", "captured", "late"],
    ["expired", "authorized", "late"],
    ["expired", null, "expired"],
    ["expired", "failed", "expired"],
    ["abandoned", null, "expired"],
  ] as const)("%s + %s -> %s", (checkoutState, paymentStatus, outcome) => {
    expect(outcomeFromStatus({ checkoutState, paymentStatus })).toBe(outcome);
  });
});

describe("the payment window is sized to the stock hold", () => {
  it("closes Checkout a margin before the hold lapses", () => {
    expect(checkoutTimeoutSeconds(600)).toBe(600 - CHECKOUT_TIMEOUT_MARGIN_SECONDS);
  });

  it("refuses to start a payment with too little hold left", () => {
    expect(checkoutTimeoutSeconds(MIN_SECONDS_TO_START_PAYMENT - 1)).toBeNull();
    expect(checkoutTimeoutSeconds(MIN_SECONDS_TO_START_PAYMENT)).toBe(
      MIN_SECONDS_TO_START_PAYMENT - CHECKOUT_TIMEOUT_MARGIN_SECONDS,
    );
  });

  it("counts whole seconds down to zero, never below", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(secondsUntil("2026-10-15T12:10:00.900Z", now)).toBe(600);
    expect(secondsUntil("2026-10-15T11:59:00Z", now)).toBe(0);
    expect(secondsUntil(null, now)).toBe(0);
    expect(formatCountdown(605)).toBe("10:05");
    expect(formatCountdown(9)).toBe("0:09");
  });

  it("polls for about three minutes before saying pending", () => {
    const total = STATUS_POLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThanOrEqual(170_000);
    expect(total).toBeLessThanOrEqual(200_000);
  });
});

describe("problemFromError — typed 409s, not message parsing", () => {
  it("carries the short lines of OUT_OF_STOCK", () => {
    const lines = [{ variantId: "v1", requested: 2, available: 0 }];
    expect(
      problemFromError({ error: { code: "OUT_OF_STOCK", message: "Short.", details: { unavailable: lines } } }),
    ).toEqual({ kind: "out_of_stock", message: "Short.", lines });
  });

  it.each([
    ["CHECKOUT_STALE", "stale"],
    ["RESERVATION_EXPIRED", "reservation_expired"],
    ["CONFLICT", "other"],
    ["RATE_LIMITED", "other"],
  ])("%s -> %s", (code, kind) => {
    expect(problemFromError({ error: { code, message: "m" } }).kind).toBe(kind);
  });

  it("falls back to a generic message for a body that is not an API error", () => {
    expect(problemFromError(null)).toEqual({ kind: "other", message: "Something went wrong. Please try again." });
    expect(problemFromError("<html>")).toMatchObject({ kind: "other" });
  });
});
