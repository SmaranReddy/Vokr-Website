import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Plan §5 Phase 16, task 2: `src/proxy.ts` sets the enforced CSP with a
 * fresh nonce on every response, and forwards the same policy on the
 * request so Next.js stamps that nonce on the scripts it renders. A
 * mismatch between the two — easiest to cause on the session-refresh path,
 * which rebuilds the response — blocks every script on the page.
 */

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([{ name: "sb-refreshed", value: "1", options: {} }]);
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

async function loadProxy({ supabase = false, secret = "" }: { supabase?: boolean; secret?: string } = {}) {
  vi.resetModules();
  vi.stubEnv("ORIGIN_AUTH_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabase ? "https://sb.test" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabase ? "anon" : "");
  return import("@/proxy");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? "")?.[1];

describe("proxy CSP", () => {
  it("enforces (not report-only) and forwards the identical policy to rendering", async () => {
    const { proxy } = await loadProxy();
    const res = await proxy(new NextRequest("https://vokr.shop/"));
    const sent = res.headers.get("content-security-policy");
    expect(sent).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(sent);
  });

  it("keeps one nonce when the session refresh rebuilds the response", async () => {
    const { proxy } = await loadProxy({ supabase: true });
    const res = await proxy(new NextRequest("https://vokr.shop/"));
    expect(res.headers.get("set-cookie")).toContain("sb-refreshed=1");
    const sent = res.headers.get("content-security-policy");
    expect(nonceOf(sent)).toBeTruthy();
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(sent);
  });

  it("gives every request its own nonce", async () => {
    const { proxy } = await loadProxy();
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 20; i += 1) {
      nonces.add(nonceOf((await proxy(new NextRequest("https://vokr.shop/"))).headers.get("content-security-policy")));
    }
    expect(nonces.size).toBe(20);
  });

  it("refusals carry the policy too", async () => {
    const { proxy } = await loadProxy({ secret: "s3cret" });
    const refused = await proxy(new NextRequest("https://vokr-test.a.run.app/"));
    expect(refused.status).toBe(404);
    expect(refused.headers.get("content-security-policy")).toMatch(/default-src 'self'/);
  });

  it("a client cannot supply its own policy to rendering", async () => {
    const { proxy } = await loadProxy();
    const res = await proxy(
      new NextRequest("https://vokr.shop/", { headers: { "content-security-policy": "script-src * 'unsafe-inline'" } }),
    );
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(res.headers.get("content-security-policy"));
    expect(res.headers.get("x-middleware-request-content-security-policy")).not.toContain("script-src *");
  });
});
