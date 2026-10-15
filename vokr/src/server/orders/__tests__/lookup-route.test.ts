import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Storefront-only launch (§2A.6 row L1): while ordering is closed there
 * are no orders, so `POST /api/orders/lookup` is refused before it reads
 * or writes anything — no rate-limit rows, no lookup. The real route
 * handler, with the lookup mocked to succeed.
 */

const lookupGuestOrder = vi.fn(async () => ({ orderNumber: "VK-10001" }));
vi.mock("@/server/orders/lookup", () => ({
  lookupGuestOrder: (...args: unknown[]) => lookupGuestOrder(...(args as [])),
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const route = await import("@/app/api/orders/lookup/route");
const { ORDERING_ENABLED, ORDERING_UNAVAILABLE_MESSAGE } = await import("@/config/commerce");

describe("POST /api/orders/lookup while ordering is closed", () => {
  it("is refused before any lookup or rate-limit work", async () => {
    expect(ORDERING_ENABLED).toBe(false);
    const response = await route.POST(
      new NextRequest("https://vokr.shop/api/orders/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNumber: "VK-10001", email: "buyer@example.com" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "ORDERING_UNAVAILABLE", message: ORDERING_UNAVAILABLE_MESSAGE });
    expect(lookupGuestOrder).not.toHaveBeenCalled();
  });
});
