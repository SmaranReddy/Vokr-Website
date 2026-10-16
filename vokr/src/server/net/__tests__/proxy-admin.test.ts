import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan §5 Phase 12 Security: "a non-admin user receives 404 on every admin
 * route and endpoint" and "an unauthenticated request receives 404, not a
 * login redirect". Tested at `src/proxy.ts` itself — the only layer that
 * can still set the status before the root `loading.tsx` streams a page.
 */

const state: {
  user: { id: string; last_sign_in_at?: string } | null;
  amr: unknown;
  admins: Set<string>;
} = { user: null, amr: undefined, admins: new Set() };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () =>
        state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: new Error("none") },
      getClaims: async () => ({ data: state.user ? { claims: { sub: state.user.id, amr: state.amr } } : null, error: null }),
    },
  }),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    appUser: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.admins.has(where.id) ? { isAdmin: true, deletedAt: null } : { isAdmin: false, deletedAt: null },
    },
  },
}));

async function loadProxy(supabase = true) {
  vi.resetModules();
  vi.stubEnv("ORIGIN_AUTH_SECRET", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabase ? "https://sb.test" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabase ? "anon" : "");
  return import("@/proxy");
}

function request(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: method === "GET" ? {} : { origin: "http://localhost:3000", "content-type": "application/json" },
  });
}

const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";
const nowS = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  state.user = null;
  state.amr = undefined;
  state.admins = new Set();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ADMIN_PATHS = [
  ["GET", "/admin"],
  ["GET", "/admin/orders"],
  ["GET", "/admin/orders/VK-10001"],
  ["GET", "/admin/logo.png"],
  ["GET", "/api/admin/exports/shiprocket"],
  ["POST", "/api/admin/inventory/adjust"],
  ["POST", "/api/admin/orders/VK-10001/refund"],
] as const;

describe("proxy admin gate", () => {
  it.each(ADMIN_PATHS)("%s %s is a 404 when signed out", async (method, path) => {
    const { proxy } = await loadProxy();
    const res = await proxy(request(path, method));
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(ADMIN_PATHS)("%s %s is a 404 for a signed-in non-admin", async (method, path) => {
    state.user = { id: "user-1" };
    state.amr = [{ method: "password", timestamp: nowS() - 60 }];
    const { proxy } = await loadProxy();
    expect((await proxy(request(path, method))).status).toBe(404);
  });

  it("is a 404 when Supabase is not configured", async () => {
    const { proxy } = await loadProxy(false);
    expect((await proxy(request("/admin"))).status).toBe(404);
  });

  it("lets a fresh admin session through, uncached", async () => {
    state.user = { id: "admin-1" };
    state.admins.add("admin-1");
    state.amr = [{ method: "password", timestamp: nowS() - 60 }];
    const { proxy } = await loadProxy();
    const res = await proxy(request("/admin/orders"));
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses an admin whose sign-in is older than the session limit", async () => {
    state.user = { id: "admin-1" };
    state.admins.add("admin-1");
    state.amr = [{ method: "password", timestamp: nowS() - 9 * 60 * 60 }];
    const { proxy } = await loadProxy();
    expect((await proxy(request("/admin/orders"))).status).toBe(404);
  });

  it("does not gate look-alike paths", async () => {
    const { proxy } = await loadProxy();
    expect(passedThrough(await proxy(request("/administrator")))).toBe(true);
  });
});
