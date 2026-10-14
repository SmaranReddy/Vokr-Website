import type { RazorpayConfig } from "./config";

/**
 * A thin, typed Razorpay client (plan §5 Phase 7, task 2) — only the three
 * calls checkout needs. Injected everywhere it is used, so every test runs
 * against a fake and no code path needs real credentials to be exercised.
 *
 * Never call this inside a database transaction or while holding a row
 * lock (R9): every method is a network round trip.
 */
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** `created | authorized | captured | refunded | failed` */
  status: string;
}

export interface RazorpayClient {
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  findOrderByReceipt(receipt: string): Promise<RazorpayOrder | null>;
  listOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
}

const API_BASE = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

export function createRazorpayClient(
  config: RazorpayConfig,
  fetchImpl: typeof fetch = fetch,
): RazorpayClient {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Razorpay's error body carries a description, never card or UPI data;
      // still, only the status and a short reason are kept.
      const detail = await response
        .json()
        .then((json: { error?: { description?: string } }) => json.error?.description ?? "")
        .catch(() => "");
      throw new RazorpayApiError(response.status, `Razorpay ${method} ${path} → ${response.status} ${detail}`.trim());
    }
    return (await response.json()) as T;
  }

  return {
    createOrder: ({ amountPaise, receipt, notes }) =>
      call<RazorpayOrder>("POST", "/orders", {
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes,
      }),
    async findOrderByReceipt(receipt) {
      const result = await call<{ items: RazorpayOrder[] }>(
        "GET",
        `/orders?receipt=${encodeURIComponent(receipt)}`,
      );
      return result.items.find((order) => order.receipt === receipt) ?? null;
    },
    async listOrderPayments(orderId) {
      const result = await call<{ items: RazorpayPayment[] }>(
        "GET",
        `/orders/${encodeURIComponent(orderId)}/payments`,
      );
      return result.items;
    },
  };
}
