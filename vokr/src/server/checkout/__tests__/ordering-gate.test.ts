import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Storefront-only launch (§2A.6 row L1), checkout half: the Phase 6 routes
 * are public, so like the cart API they must refuse every request while
 * ordering is disabled — before a session is resolved, a cookie is minted,
 * a rate-limit row is written or the database is touched. Everything
 * behind the gate is mocked to *succeed*, so a pass proves the gate alone
 * refused the request.
 */

const getSession = vi.fn();
const createCheckoutSession = vi.fn();
const setCheckoutAddress = vi.fn();
const priceCheckoutSession = vi.fn();
const assertCheckoutMutationAllowed = vi.fn();
const assertReservationAllowed = vi.fn();
const reserveCheckoutSession = vi.fn();
const assertServiceabilityLookupAllowed = vi.fn();
const getServiceability = vi.fn();
const createPaymentOrder = vi.fn();
const getPaymentStatus = vi.fn();
const assertPaymentOrderAllowed = vi.fn();

vi.mock("@/server/auth/session", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock("@/server/checkout/service", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  setCheckoutAddress: (...args: unknown[]) => setCheckoutAddress(...args),
  priceCheckoutSession: (...args: unknown[]) => priceCheckoutSession(...args),
}));

vi.mock("@/server/checkout/rate-limit", () => ({
  assertCheckoutMutationAllowed: (...args: unknown[]) =>
    assertCheckoutMutationAllowed(...args),
  assertReservationAllowed: (...args: unknown[]) =>
    assertReservationAllowed(...args),
}));

vi.mock("@/server/checkout/reserve", () => ({
  reserveCheckoutSession: (...args: unknown[]) => reserveCheckoutSession(...args),
}));

vi.mock("@/server/shipping/serviceability", () => ({
  assertServiceabilityLookupAllowed: (...args: unknown[]) =>
    assertServiceabilityLookupAllowed(...args),
  getServiceability: (...args: unknown[]) => getServiceability(...args),
}));

vi.mock("@/server/payments/service", () => ({
  createPaymentOrder: (...args: unknown[]) => createPaymentOrder(...args),
  getPaymentStatus: (...args: unknown[]) => getPaymentStatus(...args),
}));

vi.mock("@/server/payments/rate-limit", () => ({
  assertPaymentOrderAllowed: (...args: unknown[]) => assertPaymentOrderAllowed(...args),
}));

vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const sessionRoute = await import("@/app/api/checkout/session/route");
const paymentOrderRoute = await import("@/app/api/payments/razorpay/order/route");
const paymentStatusRoute = await import("@/app/api/payments/status/route");
const addressRoute =
  await import("@/app/api/checkout/session/[id]/address/route");
const pricingRoute =
  await import("@/app/api/checkout/session/[id]/pricing/route");
const reserveRoute =
  await import("@/app/api/checkout/session/[id]/reserve/route");
const serviceabilityRoute =
  await import("@/app/api/shipping/serviceability/route");
const { ORDERING_ENABLED, ORDERING_UNAVAILABLE_MESSAGE } =
  await import("@/config/commerce");

const ORIGIN = "https://vokr.shop";
const SESSION_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function request(path: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function expectOrderingUnavailable(response: Response) {
  expect(response.status).toBe(403);
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  expect(body.error.code).toBe("ORDERING_UNAVAILABLE");
  expect(body.error.message).toBe(ORDERING_UNAVAILABLE_MESSAGE);
  expect(response.headers.get("set-cookie")).toBeNull();
}

function expectNothingBehindTheGateRan() {
  for (const fn of [
    getSession,
    createCheckoutSession,
    setCheckoutAddress,
    priceCheckoutSession,
    assertCheckoutMutationAllowed,
    assertReservationAllowed,
    reserveCheckoutSession,
    assertServiceabilityLookupAllowed,
    getServiceability,
    createPaymentOrder,
    getPaymentStatus,
    assertPaymentOrderAllowed,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    identity: { kind: "guest", guestId: "g1" },
    cookiesToSet: [],
  });
  assertCheckoutMutationAllowed.mockResolvedValue(undefined);
  assertServiceabilityLookupAllowed.mockResolvedValue(undefined);
  for (const fn of [
    createCheckoutSession,
    setCheckoutAddress,
    priceCheckoutSession,
  ]) {
    fn.mockResolvedValue({ id: SESSION_ID });
  }
  getServiceability.mockResolvedValue({ serviceable: true, codEligible: true });
});

describe("checkout + payments API — ordering disabled", () => {
  it("ships with ordering disabled", () => {
    expect(ORDERING_ENABLED).toBe(false);
  });

  it("POST /api/checkout/session is refused", async () => {
    const response = await sessionRoute.POST(
      request("/api/checkout/session", "POST", {
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("PUT /api/checkout/session/[id]/address is refused", async () => {
    const response = await addressRoute.PUT(
      request(`/api/checkout/session/${SESSION_ID}/address`, "PUT", {}),
      sessionContext(SESSION_ID),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("GET /api/checkout/session/[id]/pricing is refused", async () => {
    const response = await pricingRoute.GET(
      request(
        `/api/checkout/session/${SESSION_ID}/pricing?paymentMethod=prepaid`,
        "GET",
      ),
      sessionContext(SESSION_ID),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("POST /api/checkout/session/[id]/reserve is refused — no stock is held", async () => {
    const response = await reserveRoute.POST(
      request(`/api/checkout/session/${SESSION_ID}/reserve`, "POST"),
      sessionContext(SESSION_ID),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("GET /api/shipping/serviceability is refused", async () => {
    const response = await serviceabilityRoute.GET(
      request("/api/shipping/serviceability?pincode=560001", "GET"),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("POST /api/payments/razorpay/order is refused", async () => {
    const response = await paymentOrderRoute.POST(
      request("/api/payments/razorpay/order", "POST", { checkoutSessionId: SESSION_ID }),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });

  it("GET /api/payments/status is refused", async () => {
    const response = await paymentStatusRoute.GET(
      request(`/api/payments/status?checkoutSessionId=${SESSION_ID}`, "GET"),
    );
    await expectOrderingUnavailable(response);
    expectNothingBehindTheGateRan();
  });
});
