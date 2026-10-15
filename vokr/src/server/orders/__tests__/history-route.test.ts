import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Storefront-only launch (§2A.6 row L1): the order history APIs are
 * refused before any session or database work while ordering is closed.
 * The real route handlers, with everything behind them mocked to succeed.
 */

const requireUser = vi.fn(async () => ({ userId: "u1", email: "u1@example.com", cookiesToSet: [] }));
const listUserOrders = vi.fn(async () => ({ orders: [], nextBefore: null }));
const getUserOrder = vi.fn(async () => ({ orderNumber: "VK-10001" }));

vi.mock("@/server/auth/session", () => ({ requireUser: (...args: unknown[]) => requireUser(...(args as [])) }));
vi.mock("@/server/orders/history", () => ({
  listUserOrders: (...args: unknown[]) => listUserOrders(...(args as [])),
  getUserOrder: (...args: unknown[]) => getUserOrder(...(args as [])),
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const listRoute = await import("@/app/api/orders/route");
const detailRoute = await import("@/app/api/orders/[orderNumber]/route");
const { ORDERING_ENABLED } = await import("@/config/commerce");

describe("order history APIs while ordering is closed", () => {
  it("GET /api/orders is refused before any session or database work", async () => {
    expect(ORDERING_ENABLED).toBe(false);
    const response = await listRoute.GET(new NextRequest("https://vokr.shop/api/orders"));
    expect(response.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
    expect(listUserOrders).not.toHaveBeenCalled();
  });

  it("GET /api/orders/[orderNumber] is refused before any session or database work", async () => {
    const response = await detailRoute.GET(new NextRequest("https://vokr.shop/api/orders/VK-10001"), {
      params: Promise.resolve({ orderNumber: "VK-10001" }),
    });
    expect(response.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
    expect(getUserOrder).not.toHaveBeenCalled();
  });
});
