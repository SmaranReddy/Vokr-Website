import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for `GET /api/auth/reset/confirm` — the server-side
 * `verifyOtp({ type: "recovery" })` redemption that replaced the
 * browser-side `exchangeCodeForSession(code)` (Vokr-Implementation-Plan.md,
 * Phase 3 defect log round 3).
 *
 * Lives under `src/server/**` because that is what the Vitest `node`
 * project covers; the route itself is imported directly. Supabase is
 * mocked at the `createRouteSupabaseClient` seam — `applyCookies` stays
 * real, so the tests see the cookies a redirect actually carries.
 */

const verifyOtp = vi.fn();
const completeSignIn = vi.fn();
const logServerError = vi.fn();

const SESSION_COOKIE = {
  name: "sb-test-auth-token",
  value: "session-cookie-value",
  options: { path: "/" },
};

vi.mock("@/server/auth/supabase", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/auth/supabase")>();
  return {
    ...actual,
    createRouteSupabaseClient: () => {
      const cookiesToSet: unknown[] = [];
      return {
        supabase: {
          auth: {
            verifyOtp: async (...args: unknown[]) => {
              const result = await verifyOtp(...args);
              // Mirrors the real cookie adapter: a successful
              // verification writes the session cookie.
              if (result?.data?.session) {
                cookiesToSet.push(SESSION_COOKIE);
              }
              return result;
            },
          },
        },
        cookiesToSet,
      };
    },
  };
});

vi.mock("@/server/auth/complete-sign-in", () => ({
  completeSignIn: (...args: unknown[]) => completeSignIn(...args),
}));

vi.mock("@/lib/log", () => ({
  logServerError: (...args: unknown[]) => logServerError(...args),
}));

const { GET } = await import("@/app/api/auth/reset/confirm/route");

const ORIGIN = "https://vokr.shop";
const VALID_HASH = "pkce_0123456789abcdef";

function get(query: string): Promise<Response> {
  return GET(new NextRequest(`${ORIGIN}/api/auth/reset/confirm${query}`));
}

function verifiedSession() {
  return {
    data: {
      user: { id: "user-1", email: "customer@example.com" },
      session: { access_token: "a", refresh_token: "r" },
    },
    error: null,
  };
}

beforeEach(() => {
  verifyOtp.mockReset();
  completeSignIn.mockReset();
  logServerError.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/reset/confirm", () => {
  it("redeems a recovery token_hash on the server and lands on /reset-password with the session cookie", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());

    const response = await get(`?token_hash=${VALID_HASH}&type=recovery`);

    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      type: "recovery",
      token_hash: VALID_HASH,
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/reset-password");
    expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE.name);
    expect(logServerError).not.toHaveBeenCalled();
  });

  it("does not run completeSignIn — a recovery link is not a sign-in", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());

    await get(`?token_hash=${VALID_HASH}&type=recovery`);

    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("ignores any `next` parameter — the destination is fixed", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());

    const response = await get(
      `?token_hash=${VALID_HASH}&type=recovery&next=${encodeURIComponent("https://evil.example/")}`,
    );

    expect(response.headers.get("location")).toBe("/reset-password");
  });

  it.each([
    ["missing token_hash", "?type=recovery"],
    ["malformed token_hash", "?token_hash=abc%20def&type=recovery"],
    ["missing type", `?token_hash=${VALID_HASH}`],
    ["a signup token", `?token_hash=${VALID_HASH}&type=signup`],
    ["a magiclink token", `?token_hash=${VALID_HASH}&type=magiclink`],
    ["no parameters at all", ""],
  ])(
    "rejects %s without calling Supabase and without a session cookie",
    async (_label, query) => {
      const response = await get(query);

      expect(verifyOtp).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "/reset-password?error=link",
      );
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(logServerError).toHaveBeenCalledOnce();
    },
  );

  it("fails safely on an expired or already-used token", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Token has expired or is invalid" },
    });

    const response = await get(`?token_hash=${VALID_HASH}&type=recovery`);

    expect(response.headers.get("location")).toBe(
      "/reset-password?error=link",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(logServerError).toHaveBeenCalledOnce();
  });

  it("treats a verified user with no session as a failure", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1" }, session: null },
      error: null,
    });

    const response = await get(`?token_hash=${VALID_HASH}&type=recovery`);

    expect(response.headers.get("location")).toBe(
      "/reset-password?error=link",
    );
  });

  it("fails safely when Supabase throws", async () => {
    verifyOtp.mockRejectedValue(new Error("network down"));

    const response = await get(`?token_hash=${VALID_HASH}&type=recovery`);

    expect(response.headers.get("location")).toBe(
      "/reset-password?error=link",
    );
    expect(logServerError).toHaveBeenCalledOnce();
  });
});
