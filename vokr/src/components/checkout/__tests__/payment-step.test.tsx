import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RazorpayCheckoutOptions } from "@/lib/razorpay-checkout";
import type { CheckoutSessionView } from "@/server/checkout/service";

/**
 * The prepaid payment step (plan §5 Phase 7, task 5). Razorpay Checkout is
 * a fake constructor; `fetch` is scripted per route. What matters: the
 * browser never sends an amount or the success handler's payment
 * details, and never shows success the server has not verified.
 */

const { PaymentStep } = await import("../payment-step");

const SESSION_ID = "0199e3f0-0000-7000-8000-000000000001";
const TOTAL = 999_500;

let opened: RazorpayCheckoutOptions[] = [];
let statusReplies: { checkoutState: string; paymentStatus: string | null }[] = [];
let orderReply: { status: number; body: unknown } = {
  status: 200,
  body: {
    order: { paymentId: "p1", razorpayOrderId: "order_TEST1", amountPaise: TOTAL, currency: "INR", status: "created" },
    keyId: "rzp_test_key",
  },
};
const requests: { url: string; init?: RequestInit }[] = [];

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  opened = [];
  statusReplies = [];
  requests.length = 0;
  orderReply = {
    status: 200,
    body: {
      order: { paymentId: "p1", razorpayOrderId: "order_TEST1", amountPaise: TOTAL, currency: "INR", status: "created" },
      keyId: "rzp_test_key",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === "/api/payments/razorpay/order") return json(orderReply.status, orderReply.body);
      if (url.startsWith("/api/payments/status")) {
        const next = statusReplies.length > 1 ? statusReplies.shift() : statusReplies[0];
        return json(200, { payment: { checkoutSessionId: SESSION_ID, ...(next ?? { checkoutState: "payment_pending", paymentStatus: null }) } });
      }
      return json(404, { error: { code: "NOT_FOUND", message: "no" } });
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.Razorpay;
});

function session(overrides: Partial<CheckoutSessionView> = {}): CheckoutSessionView {
  return {
    id: SESSION_ID,
    state: "reserved",
    cartId: "c1",
    address: { name: "A Buyer", phone: "9876543210", line1: "1 Road", line2: null, city: "Pune", state: "Maharashtra", pincode: "411001" },
    paymentMethod: "prepaid",
    pricingSnapshot: { totalPaise: TOTAL } as CheckoutSessionView["pricingSnapshot"],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    contactEmail: "buyer@example.com",
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("starting a payment", () => {
  it("asks the server for the order with nothing but the session id, and sizes Checkout to the hold", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<PaymentStep session={session()} onRestart={vi.fn()} onPaid={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /pay ₹9,995/i }));
    await settle();

    const order = requests.find((request) => request.url === "/api/payments/razorpay/order");
    expect(JSON.parse(String(order?.init?.body))).toEqual({ checkoutSessionId: SESSION_ID });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ key: "rzp_test_key", order_id: "order_TEST1", amount: TOTAL, currency: "INR" });
    // 10 minutes of hold, less the margin.
    expect(opened[0]?.timeout).toBeGreaterThan(560);
    expect(opened[0]?.timeout).toBeLessThanOrEqual(570);
  });

  it("does not open Checkout with under a minute of hold left", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(
      <PaymentStep
        session={session({ expiresAt: new Date(Date.now() + 45_000).toISOString() })}
        onRestart={vi.fn()}
        onPaid={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();

    expect(opened).toHaveLength(0);
    expect(requests.some((request) => request.url === "/api/payments/razorpay/order")).toBe(false);
    expect(screen.getByText(/reservation has lapsed/i)).toBeTruthy();
  });

  it("a lapsed reservation from the server offers a fresh start", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    orderReply = { status: 409, body: { error: { code: "RESERVATION_EXPIRED", message: "Your reservation has lapsed." } } };
    const onRestart = vi.fn();
    render(<PaymentStep session={session()} onRestart={onRestart} onPaid={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /start checkout again/i }));

    expect(opened).toHaveLength(0);
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("shows the hold expiring while the customer waits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(
      <PaymentStep
        session={session({ expiresAt: new Date(Date.now() + 3_000).toISOString() })}
        onRestart={vi.fn()}
        onPaid={vi.fn()}
      />,
    );
    expect(screen.getByText(/held for/i)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.getByText(/reservation has lapsed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
  });
});

describe("after Checkout reports success — untrusted until the server agrees", () => {
  async function payAndSucceed(onPaid = vi.fn()) {
    render(<PaymentStep session={session()} onRestart={vi.fn()} onPaid={onPaid} />);
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();
    // What Razorpay passes the handler; the step must never send it anywhere.
    const handler = opened[0]?.handler as unknown as (response: Record<string, string>) => void;
    act(() =>
      handler({ razorpay_payment_id: "pay_FORGED", razorpay_order_id: "order_TEST1", razorpay_signature: "sig_FORGED" }),
    );
    return onPaid;
  }

  it("shows success only once the server reports the session paid", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [
      { checkoutState: "payment_pending", paymentStatus: "created" },
      { checkoutState: "payment_pending", paymentStatus: "authorized" },
      { checkoutState: "paid", paymentStatus: "captured" },
    ];
    const onPaid = await payAndSucceed();
    await settle();
    expect(screen.getByText(/confirming your payment/i)).toBeTruthy();
    expect(screen.queryByText(/payment confirmed/i)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/payment confirmed/i)).toBeTruthy();
    expect(onPaid).toHaveBeenCalledOnce();
    const sent = requests.map((request) => `${request.url} ${String(request.init?.body ?? "")}`).join("\n");
    expect(sent).not.toMatch(/pay_FORGED|sig_FORGED|razorpay_signature/);
  });

  it("says pending, not success, when nothing is verified in time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "authorized" }];
    const onPaid = await payAndSucceed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });

    expect(screen.getByText(/haven't received confirmation/i)).toBeTruthy();
    expect(screen.getByText(/don't pay again/i)).toBeTruthy();
    expect(screen.queryByText(/payment confirmed/i)).toBeNull();
    expect(onPaid).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
  });

  it("money that arrived after the hold ended is described as refunded automatically, not as an order", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "expired", paymentStatus: "captured" }];
    const onPaid = await payAndSucceed();
    await settle();

    expect(screen.getByText(/arrived after your reservation ended/i)).toBeTruthy();
    expect(screen.getByText(/refunded automatically/i)).toBeTruthy();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("a `failed` reading after Checkout said success is an earlier attempt, not the answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    // Attempt 1 failed inside Checkout; attempt 2 succeeded, its capture not yet recorded.
    statusReplies = [
      { checkoutState: "payment_pending", paymentStatus: "failed" },
      { checkoutState: "payment_pending", paymentStatus: "failed" },
      { checkoutState: "paid", paymentStatus: "captured" },
    ];
    const onPaid = await payAndSucceed();
    await settle();
    expect(screen.queryByText(/didn't go through/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /try again|^pay/i })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText(/payment confirmed/i)).toBeTruthy();
    expect(onPaid).toHaveBeenCalledOnce();
  });

  it("never offers to pay again after a success callback, even if only `failed` is ever seen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "failed" }];
    await payAndSucceed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });

    expect(screen.getByText(/haven't received confirmation/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again|^pay/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await settle();
    expect(screen.queryByRole("button", { name: /try again|^pay/i })).toBeNull();
    expect(opened).toHaveLength(1);
  });

  it("a dismissal Razorpay reports after the success callback is ignored", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "created" }];
    await payAndSucceed();
    act(() => opened[0]?.modal.ondismiss());
    await settle();

    expect(screen.getByText(/confirming your payment/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
  });
});

describe("closing Checkout and reloading", () => {
  it("closing without paying returns to the pay button, warning not to pay twice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(<PaymentStep session={session()} onRestart={vi.fn()} onPaid={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();

    act(() => opened[0]?.modal.ondismiss());
    await settle();

    expect(screen.getByRole("alert").textContent).toMatch(/don't pay twice/i);
    expect(screen.getByRole("button", { name: /pay ₹9,995/i })).toBeTruthy();
  });

  it("a reload mid-payment reads the verified status instead of offering to pay again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "paid", paymentStatus: "captured" }];
    const onPaid = vi.fn();
    render(<PaymentStep session={session({ state: "payment_pending" })} onRestart={vi.fn()} onPaid={onPaid} />);
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
    await settle();

    expect(screen.getByText(/payment confirmed/i)).toBeTruthy();
    expect(onPaid).toHaveBeenCalledOnce();
  });
  it("a failed attempt with no success callback can be retried while the hold is live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "failed" }];
    render(<PaymentStep session={session()} onRestart={vi.fn()} onPaid={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();
    act(() => opened[0]?.modal.ondismiss());
    await settle();

    expect(screen.getByText(/didn't go through/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await settle();
    expect(opened).toHaveLength(2);
  });

  it("a reload after opening Checkout but never paying offers Pay again, with a warning", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "created" }];
    render(<PaymentStep session={session({ state: "payment_pending" })} onRestart={vi.fn()} onPaid={vi.fn()} />);
    await settle();

    expect(screen.getByRole("button", { name: /pay ₹9,995/i })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/don't pay twice/i);
  });

  it("a reload with money in flight waits for it instead of offering Pay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "authorized" }];
    render(<PaymentStep session={session({ state: "payment_pending" })} onRestart={vi.fn()} onPaid={vi.fn()} />);
    await settle();

    expect(screen.getByText(/confirming your payment/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
  });

  it("a reload after Checkout said success never offers Pay, even with no attempt recorded yet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    window.sessionStorage.setItem(`vokr:checkout:success-seen:${SESSION_ID}`, "1");
    statusReplies = [{ checkoutState: "payment_pending", paymentStatus: "created" }];
    render(<PaymentStep session={session({ state: "payment_pending" })} onRestart={vi.fn()} onPaid={vi.fn()} />);
    await settle();

    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
    expect(screen.getByText(/confirming your payment/i)).toBeTruthy();
    window.sessionStorage.clear();
  });

  it("the hold running out with Checkout open reads the status rather than sitting there", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    statusReplies = [{ checkoutState: "expired", paymentStatus: "created" }];
    render(
      <PaymentStep
        session={session({ expiresAt: new Date(Date.now() + 90_000).toISOString() })}
        onRestart={vi.fn()}
        onPaid={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pay/i }));
    await settle();
    expect(opened).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(91_000);
    });
    expect(requests.some((request) => request.url.startsWith("/api/payments/status"))).toBe(true);
    expect(screen.getByText(/reservation has lapsed/i)).toBeTruthy();
  });

  it("the ticking countdown sits outside the live region", () => {
    render(<PaymentStep session={session()} onRestart={vi.fn()} onPaid={vi.fn()} />);
    expect(screen.getByRole("status").textContent).not.toMatch(/held for/i);
    expect(screen.getByText(/held for/i)).toBeTruthy();
  });
});
