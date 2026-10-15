import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutSessionView } from "@/server/checkout/service";

/**
 * The checkout flow around the payment step (plan §5 Phase 7/8): what a
 * customer sees when stock, prices or the hold change under them. The
 * server decides every one of these; the flow only shows its typed 409s.
 */

const openCart = vi.fn();
vi.mock("@/components/cart/cart-provider", () => ({ useCart: () => ({ openCart }) }));

const { CheckoutFlow } = await import("../checkout-flow");

const KEY = "vokr:checkout:idempotency-key";

function line(variantId: string, productName: string, sizeLabel: string) {
  return {
    variantId,
    productName,
    sizeLabel,
    colorway: "Black",
    quantity: 1,
    hsnCode: "6404",
    gstRateBps: 1800,
    igstPaise: 0,
    cgstPaise: 76_233,
    sgstPaise: 76_233,
    lineSubtotalPaise: 999_500,
  };
}

function priced(overrides: Partial<CheckoutSessionView> = {}): CheckoutSessionView {
  return {
    id: "s-priced",
    state: "priced",
    cartId: "c1",
    address: { name: "A Buyer", phone: "9876543210", line1: "1 Road", line2: null, city: "Pune", state: "Maharashtra", pincode: "411001" },
    paymentMethod: "prepaid",
    pricingSnapshot: {
      lines: [line("v-8", "Model x", "IN 8")],
      subtotalPaise: 999_500,
      taxPaise: 152_466,
      shippingPaise: 0,
      codFeePaise: 0,
      totalPaise: 999_500,
    } as unknown as CheckoutSessionView["pricingSnapshot"],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    contactEmail: "buyer@example.com",
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };
let routes: Record<string, Reply[]> = {};
const calls: { url: string; init?: RequestInit }[] = [];

function reply(key: string): Reply {
  const queue = routes[key] ?? [];
  return (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "unscripted" } } };
}

beforeEach(() => {
  routes = {};
  calls.length = 0;
  openCart.mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = url.startsWith("/api/checkout/session/") && url.includes("/pricing")
        ? "pricing"
        : url.endsWith("/reserve")
          ? "reserve"
          : url === "/api/checkout/session"
            ? "session"
            : url;
      const { status, body } = reply(key);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("continuing to payment", () => {
  it("names the short lines when stock ran out, and lets the customer fix the bag", async () => {
    routes.session = [{ status: 200, body: { checkoutSession: priced() } }];
    routes.reserve = [
      {
        status: 409,
        body: {
          error: {
            code: "OUT_OF_STOCK",
            message: "Some items in your bag are no longer available in the quantity requested.",
            details: { unavailable: [{ variantId: "v-8", requested: 1, available: 0 }] },
          },
        },
      },
    ];
    render(<CheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /continue to payment/i }));

    expect(await screen.findByText(/model x · in 8: sold out/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /update your bag/i }));
    expect(openCart).toHaveBeenCalledOnce();
  });

  it("re-prices and asks for a review when the bag or prices changed", async () => {
    routes.session = [{ status: 200, body: { checkoutSession: priced() } }];
    routes.reserve = [{ status: 409, body: { error: { code: "CHECKOUT_STALE", message: "Your bag changed." } } }];
    routes.pricing = [{ status: 200, body: { checkoutSession: priced({ id: "s-priced" }) } }];
    render(<CheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /continue to payment/i }));

    expect(await screen.findByText(/please review the updated total/i)).toBeTruthy();
    expect(calls.some((call) => call.url.includes("/pricing?paymentMethod=prepaid"))).toBe(true);
  });

  it("moves to the payment step once the stock is held", async () => {
    routes.session = [{ status: 200, body: { checkoutSession: priced() } }];
    routes.reserve = [{ status: 200, body: { checkoutSession: priced({ state: "reserved" }) } }];
    render(<CheckoutFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /continue to payment/i }));

    expect(await screen.findByRole("button", { name: /pay ₹9,995/i })).toBeTruthy();
    expect(screen.getByText(/held for/i)).toBeTruthy();
    // The reserved session's address can no longer be edited.
    expect(screen.getByLabelText("Full name").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: /continue to payment/i })).toBeNull();
  });

  it("does not offer to continue with Cash on Delivery, and says why", async () => {
    routes.session = [{ status: 200, body: { checkoutSession: priced({ paymentMethod: "cod" }) } }];
    render(<CheckoutFlow />);

    const button = await screen.findByRole("button", { name: /continue to payment/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/cash on delivery isn't available yet/i)).toBeTruthy();
  });
});

describe("after paying", () => {
  it("a reload shows the confirmation once, then the next visit starts a new checkout", async () => {
    window.sessionStorage.setItem(KEY, "paid-key");
    routes.session = [{ status: 200, body: { checkoutSession: priced({ state: "paid" }) } }];
    render(<CheckoutFlow />);

    expect(await screen.findByText(/payment confirmed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pay|continue to payment/i })).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("a session that can no longer be used", () => {
  it("is replaced by a new one under a new idempotency key", async () => {
    window.sessionStorage.setItem(KEY, "old-key");
    routes.session = [
      { status: 200, body: { checkoutSession: priced({ id: "s-old", state: "expired" }) } },
      { status: 200, body: { checkoutSession: priced({ id: "s-new", state: "draft", pricingSnapshot: null, address: null }) } },
    ];
    render(<CheckoutFlow />);

    expect(await screen.findByText(/previous checkout lapsed/i)).toBeTruthy();
    const keys = calls
      .filter((call) => call.url === "/api/checkout/session")
      .map((call) => (JSON.parse(String(call.init?.body)) as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe("old-key");
    expect(keys[1]).not.toBe("old-key");
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toBe(keys[1]));
  });
});
