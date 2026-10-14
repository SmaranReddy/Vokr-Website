import { describe, expect, it, vi } from "vitest";

import { createRazorpayClient } from "../razorpay";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const CONFIG = { keyId: "rzp_test_k", keySecret: "s" };

describe("Razorpay client", () => {
  it("creates an INR order with basic auth and the given receipt", async () => {
    const fetchImpl = fakeFetch(200, {
      id: "order_1",
      amount: 100,
      currency: "INR",
      receipt: "r",
      status: "created",
    });
    const client = createRazorpayClient(CONFIG, fetchImpl as unknown as typeof fetch);

    await client.createOrder({ amountPaise: 100, receipt: "r", notes: { a: "b" } });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("rzp_test_k:s").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 100,
      currency: "INR",
      receipt: "r",
      notes: { a: "b" },
    });
  });

  it("findOrderByReceipt returns only an exact receipt match", async () => {
    const client = createRazorpayClient(
      CONFIG,
      fakeFetch(200, { items: [{ id: "order_x", receipt: "other" }] }) as unknown as typeof fetch,
    );
    expect(await client.findOrderByReceipt("r")).toBeNull();
  });

  it("creates a refund with X-Refund-Idempotency and a body that is identical on every retry", async () => {
    const fetchImpl = fakeFetch(200, { id: "rfnd_1", payment_id: "pay_1", amount: 100, status: "pending" });
    const client = createRazorpayClient(CONFIG, fetchImpl as unknown as typeof fetch);
    const input = { paymentId: "pay_1", amountPaise: 100, receipt: "vokr_late_pay_1", idempotencyKey: "vokr_late_pay_1" };

    await client.createRefund(input);
    await client.createRefund(input);

    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe("https://api.razorpay.com/v1/payments/pay_1/refund");
    expect(calls[0]?.[1].method).toBe("POST");
    expect((calls[0]?.[1].headers as Record<string, string>)["x-refund-idempotency"]).toBe("vokr_late_pay_1");
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({ amount: 100, speed: "normal", receipt: "vokr_late_pay_1" });
    expect(calls[1]?.[1].body).toBe(calls[0]?.[1].body);
  });

  it("surfaces an API failure as RazorpayApiError with the status", async () => {
    const client = createRazorpayClient(
      CONFIG,
      fakeFetch(400, { error: { description: "receipt already exists" } }) as unknown as typeof fetch,
    );
    await expect(
      client.createOrder({ amountPaise: 1, receipt: "r", notes: {} }),
    ).rejects.toMatchObject({ name: "RazorpayApiError", status: 400 });
  });
});
