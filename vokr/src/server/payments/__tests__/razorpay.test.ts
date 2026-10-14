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
