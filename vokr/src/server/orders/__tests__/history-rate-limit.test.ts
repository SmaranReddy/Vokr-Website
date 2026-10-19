import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { RateLimitError } from "@/lib/errors";

/**
 * Plan §5 Phase 16 task 6: signed-in order history is rate limited per
 * user, and a refused read never reaches the database. Ordering is opened
 * for this file only (the gate is tested in history-route.test.ts).
 */

const requireUser = vi.fn(async () => ({ userId: "u1", email: "u1@example.com", cookiesToSet: [] }));
const listUserOrders = vi.fn(async () => ({ orders: [], nextBefore: null }));
const getUserOrder = vi.fn(async () => ({ orderNumber: "VK-10001" }));
const assertWithinRateLimit = vi.fn<(options: { key: string; limit: number; windowMs: number }) => Promise<void>>(async () => {});

vi.mock("@/server/cart/ordering-gate", () => ({ assertOrderingEnabled: () => {} }));
vi.mock("@/server/auth/session", () => ({ requireUser: (...args: unknown[]) => requireUser(...(args as [])) }));
vi.mock("@/server/orders/history", () => ({
  listUserOrders: (...args: unknown[]) => listUserOrders(...(args as [])),
  getUserOrder: (...args: unknown[]) => getUserOrder(...(args as [])),
}));
vi.mock("@/server/rate-limit", () => ({
  assertWithinRateLimit: (options: { key: string; limit: number; windowMs: number }) => assertWithinRateLimit(options),
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const listRoute = await import("@/app/api/orders/route");
const detailRoute = await import("@/app/api/orders/[orderNumber]/route");

const detail = () =>
  detailRoute.GET(new NextRequest("https://vokr.shop/api/orders/VK-10001"), {
    params: Promise.resolve({ orderNumber: "VK-10001" }),
  });

describe("order history rate limit", () => {
  it("both reads take the per-user bucket", async () => {
    expect((await listRoute.GET(new NextRequest("https://vokr.shop/api/orders"))).status).toBe(200);
    expect((await detail()).status).toBe(200);
    expect(assertWithinRateLimit.mock.calls.map(([options]) => options.key)).toEqual(["orders:read:user:u1", "orders:read:user:u1"]);
  });

  it("a refused read answers 429 without touching the database", async () => {
    assertWithinRateLimit.mockRejectedValue(new RateLimitError("Too many requests."));
    listUserOrders.mockClear();
    getUserOrder.mockClear();
    expect((await listRoute.GET(new NextRequest("https://vokr.shop/api/orders"))).status).toBe(429);
    expect((await detail()).status).toBe(429);
    expect(listUserOrders).not.toHaveBeenCalled();
    expect(getUserOrder).not.toHaveBeenCalled();
  });
});
