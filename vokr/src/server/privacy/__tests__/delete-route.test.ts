import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "@/lib/errors";

const requireUser = vi.fn();
const requestErasure = vi.fn();
const assertWithinRateLimit = vi.fn();

vi.mock("@/server/auth/session", () => ({ requireUser: (request: unknown) => requireUser(request) }));
vi.mock("@/server/privacy/erasure", () => ({ requestErasure: (userId: string) => requestErasure(userId) }));
vi.mock("@/server/rate-limit", () => ({ assertWithinRateLimit: (input: unknown) => assertWithinRateLimit(input) }));

const { POST } = await import("@/app/api/privacy/delete/route");

const post = (body: unknown) =>
  POST(new NextRequest("https://vokr.shop/api/privacy/delete", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

/** `POST /api/privacy/delete` records a request only — never erases (plan §5 Phase 17, tasks 5–6). */
describe("POST /api/privacy/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireUser.mockResolvedValue({ userId: "u1", email: "a@example.com", cookiesToSet: [] });
    assertWithinRateLimit.mockResolvedValue(undefined);
  });

  it("signed out is 401 and records nothing", async () => {
    requireUser.mockRejectedValue(new UnauthorizedError("Sign in required."));
    expect((await post({ confirm: true })).status).toBe(401);
    expect(requestErasure).not.toHaveBeenCalled();
  });

  it("needs an explicit confirmation", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ confirm: "yes" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(requestErasure).not.toHaveBeenCalled();
  });

  it("202 for a new request, 200 for the one already open — for the caller's own account only", async () => {
    const row = { id: "r1", state: "requested", createdAt: new Date("2026-10-19T00:00:00Z") };
    requestErasure.mockResolvedValueOnce({ request: row, created: true }).mockResolvedValueOnce({ request: row, created: false });
    const first = await post({ confirm: true });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ request: { id: "r1", state: "requested", createdAt: "2026-10-19T00:00:00.000Z" }, created: true });
    expect((await post({ confirm: true })).status).toBe(200);
    expect(requestErasure).toHaveBeenCalledWith("u1");
    expect(first.headers.get("cache-control")).toBe("no-store");
  });
});
