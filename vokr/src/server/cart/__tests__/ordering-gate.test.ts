import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Storefront-only launch (§2A.6 row L1): the cart API is public, so the
 * disabled Add to Cart button is not enough. These call the real route
 * handlers with everything behind them mocked to *succeed* — an active,
 * in-stock variant, a valid session, an open rate limit — and prove the
 * request is still refused before any of it runs. (Route tests live under
 * `src/server/**` so the node test project picks them up.)
 */

const getSession = vi.fn();
const addItem = vi.fn();
const updateQuantity = vi.fn();
const removeItem = vi.fn();
const clearCart = vi.fn();
const getCart = vi.fn();
const assertCartMutationAllowed = vi.fn();

vi.mock("@/server/auth/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock("@/server/cart", () => ({
  addItem: (...args: unknown[]) => addItem(...args),
  updateQuantity: (...args: unknown[]) => updateQuantity(...args),
  removeItem: (...args: unknown[]) => removeItem(...args),
  clearCart: (...args: unknown[]) => clearCart(...args),
  getCart: (...args: unknown[]) => getCart(...args),
}));

vi.mock("@/server/cart/rate-limit", () => ({
  assertCartMutationAllowed: (...args: unknown[]) => assertCartMutationAllowed(...args),
}));

vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const itemsRoute = await import("@/app/api/cart/items/route");
const itemRoute = await import("@/app/api/cart/items/[id]/route");
const cartRoute = await import("@/app/api/cart/route");
const { ORDERING_ENABLED, ORDERING_UNAVAILABLE_MESSAGE } = await import(
  "@/config/commerce"
);
const { assertOrderingEnabled } = await import("@/server/cart/ordering-gate");

const ORIGIN = "https://vokr.shop";
const CART = { cartId: "c1", items: [], subtotalPaise: 0, taxPaise: 0, totalPaise: 0 };
const ACTIVE_IN_STOCK_VARIANT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function itemContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function expectOrderingUnavailable(response: Response) {
  expect(response.status).toBe(403);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("ORDERING_UNAVAILABLE");
  expect(body.error.message).toBe(ORDERING_UNAVAILABLE_MESSAGE);
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ identity: { kind: "guest", guestId: "g1" }, cookiesToSet: [] });
  assertCartMutationAllowed.mockResolvedValue(undefined);
  for (const fn of [addItem, updateQuantity, removeItem, clearCart, getCart]) {
    fn.mockResolvedValue(CART);
  }
});

describe("cart API — ordering disabled", () => {
  it("ships with ordering disabled", () => {
    expect(ORDERING_ENABLED).toBe(false);
    expect(() => assertOrderingEnabled()).toThrow(ORDERING_UNAVAILABLE_MESSAGE);
  });

  it("POST /api/cart/items refuses an active, in-stock variant", async () => {
    const response = await itemsRoute.POST(
      request("/api/cart/items", "POST", { variantId: ACTIVE_IN_STOCK_VARIANT, quantity: 1 }),
    );
    await expectOrderingUnavailable(response);
    expect(addItem).not.toHaveBeenCalled();
  });

  it("POST /api/cart/items is refused before any session, rate-limit or body work", async () => {
    const response = await itemsRoute.POST(request("/api/cart/items", "POST", { nonsense: true }));
    await expectOrderingUnavailable(response);
    expect(getSession).not.toHaveBeenCalled();
    expect(assertCartMutationAllowed).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([1, 5, 10])("PATCH /api/cart/items/[id] refuses quantity %d", async (quantity) => {
    const response = await itemRoute.PATCH(
      request("/api/cart/items/item-1", "PATCH", { quantity }),
      itemContext("item-1"),
    );
    await expectOrderingUnavailable(response);
    expect(updateQuantity).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("DELETE /api/cart/items/[id] still lets a customer remove an item", async () => {
    const response = await itemRoute.DELETE(
      request("/api/cart/items/item-1", "DELETE"),
      itemContext("item-1"),
    );
    expect(response.status).toBe(200);
    expect(removeItem).toHaveBeenCalledOnce();
  });

  it("DELETE /api/cart still lets a customer empty the bag", async () => {
    const response = await cartRoute.DELETE(request("/api/cart", "DELETE"));
    expect(response.status).toBe(200);
    expect(clearCart).toHaveBeenCalledOnce();
  });

  it("GET /api/cart still reads the bag", async () => {
    const response = await cartRoute.GET(request("/api/cart", "GET"));
    expect(response.status).toBe(200);
  });
});
