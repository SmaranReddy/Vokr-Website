import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The real route handlers with the service mocked: while ordering is
 * closed the customer routes refuse before any lookup or rate-limit work
 * (as `POST /api/orders/lookup` does), and every admin returns route is a
 * 404 to anyone who is not an active admin.
 */

const service = vi.hoisted(() => ({
  requestReturnAsGuest: vi.fn(),
  listReturnsAsGuest: vi.fn(),
  decideReturn: vi.fn(),
  receiveReturn: vi.fn(),
  dispatchReplacement: vi.fn(),
  refundReturn: vi.fn(),
  recordManualRefund: vi.fn(),
  receiveRto: vi.fn(),
}));
vi.mock("@/server/returns/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/returns/service")>()),
  ...service,
}));
vi.mock("@/server/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/server/rate-limit", () => ({ assertWithinRateLimit: vi.fn(async () => undefined), consumeRateLimit: vi.fn() }));
const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/server/admin/guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/admin/guard")>();
  return { ...original, requireAdmin };
});

const { ORDERING_ENABLED } = await import("@/config/commerce");
const { AdminNotFoundError } = await import("@/server/admin/guard");

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("customer returns routes while ordering is closed", () => {
  it.each([
    ["@/app/api/returns/request/route", "https://vokr.shop/api/returns/request"],
    ["@/app/api/returns/lookup/route", "https://vokr.shop/api/returns/lookup"],
  ])("%s answers 403 before any work", async (module, url) => {
    expect(ORDERING_ENABLED).toBe(false);
    const route = (await import(/* @vite-ignore */ module)) as { POST: (request: NextRequest) => Promise<Response> };
    const response = await route.POST(post(url, { orderNumber: "VK-10001", email: "buyer@example.com" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(service.requestReturnAsGuest).not.toHaveBeenCalled();
    expect(service.listReturnsAsGuest).not.toHaveBeenCalled();
  });
});

describe("admin returns routes", () => {
  const returnId = "0192f0aa-0000-7000-8000-000000000001";
  const cases = [
    {
      name: "action",
      load: () => import("@/app/api/admin/returns/[returnId]/route"),
      url: `https://vokr.shop/api/admin/returns/${returnId}`,
      params: { returnId },
      body: { action: "decide", input: { decision: "approve" } },
    },
    {
      name: "refund",
      load: () => import("@/app/api/admin/returns/[returnId]/refund/route"),
      url: `https://vokr.shop/api/admin/returns/${returnId}/refund`,
      params: { returnId },
      body: { action: "refund", input: { confirmOrderNumber: "VK-10001", reason: "returned" } },
    },
    {
      name: "rto",
      load: () => import("@/app/api/admin/orders/[orderNumber]/rto/route"),
      url: "https://vokr.shop/api/admin/orders/VK-10001/rto",
      params: { orderNumber: "VK-10001" },
      body: { items: [{ sku: "VK-X", qcPassed: true, restock: true }] },
    },
  ];

  it.each(cases)("$name is a 404 for a non-admin and calls nothing", async ({ load, url, params, body }) => {
    requireAdmin.mockRejectedValueOnce(new AdminNotFoundError());
    const route = (await load()) as unknown as { POST: (request: NextRequest, context: { params: Promise<unknown> }) => Promise<Response> };
    const response = await route.POST(post(url, body), { params: Promise.resolve(params) });
    expect(response.status).toBe(404);
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("the refund route asks the guard for a recent sign-in", async () => {
    requireAdmin.mockRejectedValueOnce(new AdminNotFoundError());
    const route = await import("@/app/api/admin/returns/[returnId]/refund/route");
    await route.POST(post(cases[1]!.url, cases[1]!.body), { params: Promise.resolve({ returnId }) });
    expect(requireAdmin).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ reauthWithinS: expect.any(Number) }));
  });

  it("an admin's malformed action input is a 400 and calls nothing", async () => {
    requireAdmin.mockResolvedValueOnce({ adminId: "a", actor: "admin:a", cookiesToSet: [] });
    const route = await import("@/app/api/admin/returns/[returnId]/route");
    const response = await route.POST(post(cases[0]!.url, { action: "receive", input: { qcPassed: false, restock: true } }), {
      params: Promise.resolve({ returnId }),
    });
    expect(response.status).toBe(400);
    expect(service.receiveReturn).not.toHaveBeenCalled();
  });
});
