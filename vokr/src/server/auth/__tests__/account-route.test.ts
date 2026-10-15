import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /account` (the header account icon's target once ordering opens):
 * a signed-in customer goes to their orders, anyone else to sign-in, and
 * while ordering is closed everyone goes to sign-in. Never creates a guest
 * session.
 */

const flags = { orderingEnabled: false };
vi.mock("@/config/commerce", () => ({
  get ORDERING_ENABLED() {
    return flags.orderingEnabled;
  },
}));

const getUser = vi.fn();
vi.mock("@/server/auth/supabase", () => ({
  createRouteSupabaseClient: () => ({ supabase: { auth: { getUser } }, cookiesToSet: [] }),
  applyCookies: <T>(response: T) => response,
}));

const route = await import("@/app/account/route");

function get() {
  return route.GET(new NextRequest("https://vokr.shop/account"));
}

beforeEach(() => {
  getUser.mockReset();
});

describe("GET /account", () => {
  it("while ordering is closed, always goes to sign-in without reading a session", async () => {
    flags.orderingEnabled = false;
    const response = await get();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/sign-in");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("once ordering is open, a signed-in customer goes to their orders", async () => {
    flags.orderingEnabled = true;
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect((await get()).headers.get("location")).toBe("/orders");
  });

  it("once ordering is open, anyone else goes to sign-in — including when auth fails", async () => {
    flags.orderingEnabled = true;
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await get()).headers.get("location")).toBe("/sign-in");
    getUser.mockRejectedValue(new Error("auth down"));
    expect((await get()).headers.get("location")).toBe("/sign-in");
  });
});
