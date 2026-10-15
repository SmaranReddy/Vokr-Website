import axe from "axe-core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RazorpayCheckoutOptions } from "@/lib/razorpay-checkout";
import type { CheckoutSessionView } from "@/server/checkout/service";

/**
 * Structural accessibility of the checkout and payment step (WCAG 2 A/AA
 * axe rules) in jsdom. `/checkout` 404s while ORDERING_ENABLED is false (a
 * hardcoded constant by design), so the Playwright axe harness cannot
 * reach it yet. jsdom has no layout, so colour contrast is not checked
 * here; that waits for the browser run once ordering can be enabled in a
 * test build.
 */

vi.mock("@/components/cart/cart-provider", () => ({ useCart: () => ({ openCart: vi.fn() }) }));

const { CheckoutFlow } = await import("../checkout-flow");
const { PaymentStep } = await import("../payment-step");

const SESSION: CheckoutSessionView = {
  id: "0199e3f0-0000-7000-8000-000000000001",
  state: "priced",
  cartId: "c1",
  address: { name: "A Buyer", phone: "9876543210", line1: "1 Road", line2: null, city: "Pune", state: "Maharashtra", pincode: "411001" },
  paymentMethod: "prepaid",
  pricingSnapshot: {
    lines: [
      {
        variantId: "v-8",
        productName: "Model x",
        sizeLabel: "IN 8",
        colorway: "Black",
        quantity: 1,
        hsnCode: "6404",
        gstRateBps: 1800,
        igstPaise: 0,
        cgstPaise: 76_233,
        sgstPaise: 76_233,
        lineSubtotalPaise: 999_500,
      },
    ],
    subtotalPaise: 999_500,
    taxPaise: 152_466,
    shippingPaise: 0,
    codFeePaise: 0,
    totalPaise: 999_500,
  } as unknown as CheckoutSessionView["pricingSnapshot"],
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

async function seriousViolations(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = url === "/api/checkout/session"
        ? { checkoutSession: SESSION }
        : url.startsWith("/api/payments/status")
          ? { payment: { checkoutState: "payment_pending", paymentStatus: "authorized" } }
          : url === "/api/payments/razorpay/order"
            ? { order: { razorpayOrderId: "order_1", amountPaise: 999_500, currency: "INR" }, keyId: "rzp_test_key" }
            : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  window.Razorpay = class {
    constructor(readonly options: RazorpayCheckoutOptions) {
      opened.push(options);
    }
    open() {}
    on() {}
  } as unknown as typeof window.Razorpay;
});

const opened: RazorpayCheckoutOptions[] = [];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.Razorpay;
  opened.length = 0;
});

describe("checkout accessibility (axe, structural rules)", () => {
  it("the address, method and review steps", async () => {
    const { container } = render(<CheckoutFlow />);
    await screen.findByRole("button", { name: /continue to payment/i });
    expect(await seriousViolations(container)).toEqual([]);
  });

  it("the payment step, ready and verifying", async () => {
    const { container } = render(
      <PaymentStep session={{ ...SESSION, state: "reserved" }} onRestart={vi.fn()} onPaid={vi.fn()} />,
    );
    expect(await seriousViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await screen.findByRole("button", { name: /pay/i });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => opened[0]?.handler());
    await screen.findByText(/confirming your payment/i);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
