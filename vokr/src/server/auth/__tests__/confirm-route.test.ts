import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for `GET /api/auth/confirm` — the server-side
 * `verifyOtp({ type: "signup" })` email-confirmation flow
 * (Vokr-Implementation-Plan.md, Phase 3 verification round 2). See
 * `reset-confirm-route.test.ts` for why these live under `src/server/**`.
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

const { GET } = await import("@/app/api/auth/confirm/route");

const ORIGIN = "https://vokr.shop";
const VALID_HASH = "pkce_0123456789abcdef";

function get(query: string): Promise<Response> {
  return GET(new NextRequest(`${ORIGIN}/api/auth/confirm${query}`));
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

describe("GET /api/auth/confirm", () => {
  it("verifies a signup token_hash on the server, completes sign-in and redirects home", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());

    const response = await get(`?token_hash=${VALID_HASH}&type=signup`);

    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      type: "signup",
      token_hash: VALID_HASH,
    });
    expect(completeSignIn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: "user-1",
        userEmail: "customer@example.com",
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(response.headers.get("set-cookie")).toContain(SESSION_COOKIE.name);
  });

  it("honours a same-origin `next` path", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());

    const response = await get(
      `?token_hash=${VALID_HASH}&type=signup&next=${encodeURIComponent("/cart")}`,
    );

    expect(response.headers.get("location")).toBe(`${ORIGIN}/cart`);
  });

  it.each(["//evil.example", "https://evil.example/", "/\\evil.example"])(
    "falls back to / for an off-origin `next` (%s)",
    async (next) => {
      verifyOtp.mockResolvedValue(verifiedSession());

      const response = await get(
        `?token_hash=${VALID_HASH}&type=signup&next=${encodeURIComponent(next)}`,
      );

      expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    },
  );

  it.each([
    ["a recovery token", `?token_hash=${VALID_HASH}&type=recovery`],
    ["missing token_hash", "?type=signup"],
    ["malformed token_hash", "?token_hash=a%2Fb&type=signup"],
    ["missing type", `?token_hash=${VALID_HASH}`],
  ])(
    "rejects %s without calling Supabase or signing anyone in",
    async (_label, query) => {
      const response = await get(query);

      expect(verifyOtp).not.toHaveBeenCalled();
      expect(completeSignIn).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe(
        `${ORIGIN}/sign-in?error=confirm`,
      );
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("fails safely on an expired or already-used token", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Token has expired or is invalid" },
    });

    const response = await get(`?token_hash=${VALID_HASH}&type=signup`);

    expect(completeSignIn).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/sign-in?error=confirm`,
    );
    expect(logServerError).toHaveBeenCalledOnce();
  });

  it("fails safely when completeSignIn throws", async () => {
    verifyOtp.mockResolvedValue(verifiedSession());
    completeSignIn.mockRejectedValue(new Error("db down"));

    const response = await get(`?token_hash=${VALID_HASH}&type=signup`);

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/sign-in?error=confirm`,
    );
    expect(logServerError).toHaveBeenCalledOnce();
  });
});
