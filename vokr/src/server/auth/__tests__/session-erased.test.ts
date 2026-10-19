import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getOrCreateAppUser = vi.fn();
const getOrCreateGuestSession = vi.fn();

vi.mock("../supabase", () => ({
  createRouteSupabaseClient: () => ({ supabase: { auth: { getUser } }, cookiesToSet: [] }),
}));
vi.mock("../app-user", () => ({ getOrCreateAppUser: (input: unknown) => getOrCreateAppUser(input) }));
vi.mock("../guest", () => ({
  GUEST_COOKIE_NAME: "vokr_guest",
  clearGuestCookie: () => ({ name: "vokr_guest", value: "", options: {} }),
  getOrCreateGuestSession: (token: unknown) => getOrCreateGuestSession(token),
}));

const { getSession, requireUser } = await import("../session");

/**
 * Plan §5 Phase 17: an erased account keeps its Supabase Auth user until an
 * operator deletes it, so a still-valid token must not act as that account.
 */
describe("getSession with an erased account", () => {
  const request = () => new NextRequest("https://vokr.shop/api/orders");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@example.com" } }, error: null });
    getOrCreateGuestSession.mockResolvedValue({ guestSessionId: "g1", setCookie: null });
  });

  it("resolves a live account as the user", async () => {
    getOrCreateAppUser.mockResolvedValue({ id: "u1", email: "a@example.com", createdAt: new Date(), deletedAt: null });
    expect((await getSession(request())).identity).toEqual({ type: "user", userId: "u1", email: "a@example.com" });
  });

  it("resolves an erased account as a guest, and requireUser refuses it", async () => {
    getOrCreateAppUser.mockResolvedValue({ id: "u1", email: "erased-u1@erased.invalid", createdAt: new Date(), deletedAt: new Date() });
    expect((await getSession(request())).identity).toEqual({ type: "guest", guestSessionId: "g1" });
    await expect(requireUser(request())).rejects.toThrow(/Sign in required/);
  });
});
