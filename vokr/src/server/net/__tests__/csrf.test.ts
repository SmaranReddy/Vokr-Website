import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkCrossSite, CROSS_SITE_EXEMPT_PATHS, siteOriginFrom } from "../csrf";

/**
 * Phase 16, task 3: a state-changing API request from another site is
 * refused. Unit matrix for `checkCrossSite`, then the real `src/proxy.ts`
 * end to end.
 */

const SITE = "https://vokr.shop";

function request(path: string, method: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://0.0.0.0:3000${path}`, { method, headers });
}

describe("checkCrossSite", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s from this site is allowed", (method) => {
    expect(checkCrossSite(request("/api/cart/items", method, { origin: SITE }), SITE)).toBe("allowed");
  });

  it.each([
    ["another site", { origin: "https://evil.example" }],
    ["a look-alike subdomain", { origin: "https://vokr.shop.evil.example" }],
    ["plain http", { origin: "http://vokr.shop" }],
    ["an opaque origin", { origin: "null" }],
    ["no Origin but a browser-labelled cross-site request", { "sec-fetch-site": "cross-site" }],
  ])("POST from %s is refused", (_label, headers) => {
    expect(checkCrossSite(request("/api/cart/items", "POST", headers), SITE)).toBe("refused");
  });

  it("is judged against the configured site, never the server's own URL", () => {
    // The request is addressed to the bind address, as behind Cloud Run.
    expect(checkCrossSite(request("/api/cart/items", "POST", { origin: "https://0.0.0.0:3000" }), SITE)).toBe("refused");
  });

  it("a non-browser client (no Origin, no Sec-Fetch-Site) is allowed — CSRF is a browser attack", () => {
    expect(checkCrossSite(request("/api/cart/items", "POST"), SITE)).toBe("allowed");
  });

  it("safe methods and non-API paths are out of scope", () => {
    expect(checkCrossSite(request("/api/cart", "GET", { origin: "https://evil.example" }), SITE)).toBe("allowed");
    expect(checkCrossSite(request("/shop/model-x", "POST", { origin: "https://evil.example" }), SITE)).toBe("allowed");
  });

  it.each([...CROSS_SITE_EXEMPT_PATHS])("server-to-server %s is exempt (signature / OIDC authenticated)", (path) => {
    expect(checkCrossSite(request(path, "POST", { origin: "https://api.razorpay.com" }), SITE)).toBe("allowed");
  });

  it("siteOriginFrom", () => {
    expect(siteOriginFrom("https://vokr.shop/")).toBe(SITE);
    expect(siteOriginFrom("not a url")).toBeNull();
  });
});

describe("src/proxy.ts refuses cross-site API writes before any route runs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadProxy() {
    vi.resetModules();
    vi.stubEnv("ORIGIN_AUTH_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    return import("@/proxy");
  }

  it("403 for another site's POST; passes this site's", async () => {
    const { proxy } = await loadProxy();

    const refused = await proxy(request("/api/auth/signout", "POST", { origin: "https://evil.example" }));
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("CROSS_SITE_REQUEST");

    const allowed = await proxy(request("/api/auth/signout", "POST", { origin: SITE }));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });

  it("the Razorpay webhook still passes", async () => {
    const { proxy } = await loadProxy();
    const res = await proxy(request("/api/webhooks/razorpay", "POST", { origin: "https://api.razorpay.com" }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
