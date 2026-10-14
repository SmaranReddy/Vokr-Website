import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../../../infra/cloudflare/edge-worker.mjs";
import {
  ORIGIN_AUTH_HEADER,
  VERIFIED_ORIGIN_HEADER,
} from "@/server/net/origin-auth";

/**
 * D9 (ADR-031) end to end at the application boundary: `src/proxy.ts`
 * itself, not just `checkOrigin`, because the hole this guards against
 * was in the proxy's `matcher` — `checkOrigin` was correct, it simply
 * never ran for `/shop/anything.png` or `/api/catalog/products/anything.png`
 * (both reached the page / route handler on `run.app` with no secret).
 */

const SECRET = "test-origin-secret";
const ORIGIN_HOST = "vokr-test.a.run.app";

/**
 * Only invoked when a test configures Supabase — then `getUser()` drives
 * the cookie-refresh `setAll` path, which rebuilds the response and must
 * keep the same origin verdict.
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          c: { name: string; value: string; options: object }[],
        ) => void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([
          { name: "sb-refreshed", value: "1", options: {} },
        ]);
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

/** `env.ts` and `proxy.ts` read the environment once, at import. */
async function loadProxy({
  secret,
  supabase = false,
}: {
  secret: string | undefined;
  supabase?: boolean;
}) {
  vi.resetModules();
  vi.stubEnv("ORIGIN_AUTH_SECRET", secret ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabase ? "https://sb.test" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabase ? "anon" : "");
  return import("@/proxy");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function originRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest(`https://${ORIGIN_HOST}${path}`, init);
}

/** True when the proxy let the request continue to the app. */
function passedThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

/** The verified-origin value the downstream handler will see, if any. */
function forwardedVerifiedHeader(res: Response): string | null {
  return res.headers.get(`x-middleware-request-${VERIFIED_ORIGIN_HEADER}`);
}

function overriddenHeaders(res: Response): string[] {
  return (res.headers.get("x-middleware-override-headers") ?? "")
    .split(",")
    .filter(Boolean);
}

/**
 * Application routes reachable on `run.app`, including the image-suffixed
 * dynamic paths the old matcher skipped.
 */
const APP_PATHS = [
  "/",
  "/cart",
  "/shop",
  "/shop/some-product",
  "/shop/x.png",
  "/shop/x.svg",
  "/api/catalog/products",
  "/api/catalog/products/x.png",
  "/api/cart/items/abc.jpg",
  "/api/auth/signin",
  "/api/health.png",
  "/_next/static/chunks/app.js",
  "/_next/image?url=%2Fx.png&w=640&q=75",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

describe("proxy matcher", () => {
  it("covers every path, so no route can sit outside the origin check", async () => {
    const { config } = await loadProxy({ secret: SECRET });
    for (const path of [...APP_PATHS, "/api/health"]) {
      expect(
        unstable_doesMiddlewareMatch({ config, url: path }),
        `matcher must cover ${path}`,
      ).toBe(true);
    }
  });
});

describe("proxy origin check — direct requests to run.app", () => {
  it("refuses every application route without the secret", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    for (const path of APP_PATHS) {
      const res = await proxy(originRequest(path));
      expect(res.status, `GET ${path}`).toBe(404);
      expect(passedThrough(res), `GET ${path}`).toBe(false);
    }
  });

  it("refuses non-GET methods too (route handlers, Server Functions)", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await proxy(
        originRequest("/api/cart/items/abc.png", {
          method,
          headers: { "next-action": "abc" },
        }),
      );
      expect(res.status, method).toBe(404);
    }
  });

  it("refuses a wrong secret and a forged verified-origin flag", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    const res = await proxy(
      originRequest("/api/catalog/products/x.png", {
        headers: {
          [ORIGIN_AUTH_HEADER]: "not-the-secret",
          [VERIFIED_ORIGIN_HEADER]: "1",
          "cf-connecting-ip": "203.0.113.9",
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("is not skipped by a spoofed x-middleware-subrequest header", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    const res = await proxy(
      originRequest("/cart", {
        headers: {
          "x-middleware-subrequest":
            "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy",
        },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("proxy origin check — requests carrying the Worker's secret", () => {
  it("passes every application route and marks the origin verified", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    for (const path of APP_PATHS) {
      const res = await proxy(
        originRequest(path, { headers: { [ORIGIN_AUTH_HEADER]: SECRET } }),
      );
      expect(passedThrough(res), `GET ${path}`).toBe(true);
      expect(forwardedVerifiedHeader(res), `GET ${path}`).toBe("1");
    }
  });

  it("accepts exactly what the deployed Worker sends upstream", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    const realFetch = globalThis.fetch;
    let upstream: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstream = new Request(input, init);
      return new Response("ok");
    }) as typeof fetch;
    try {
      await worker.fetch(
        new Request("https://vokr.shop/shop/x.png", {
          headers: { [ORIGIN_AUTH_HEADER]: "forged-by-visitor" },
        }),
        { ORIGIN_HOST, ORIGIN_AUTH_SECRET: SECRET },
      );
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(upstream).toBeDefined();
    const res = await proxy(new NextRequest(upstream!));
    expect(passedThrough(res)).toBe(true);
    expect(forwardedVerifiedHeader(res)).toBe("1");
  });

  it("keeps the verified mark when the Supabase session refresh rebuilds the response", async () => {
    const { proxy } = await loadProxy({ secret: SECRET, supabase: true });
    const res = await proxy(
      originRequest("/cart", { headers: { [ORIGIN_AUTH_HEADER]: SECRET } }),
    );
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("sb-refreshed=1");
    expect(forwardedVerifiedHeader(res)).toBe("1");
  });
});

describe("proxy origin check — /api/health", () => {
  it("stays reachable without the secret (startup probe, keep-warm, smoke test)", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    for (const path of ["/api/health", "/api/health?probe=1"]) {
      const res = await proxy(originRequest(path));
      expect(passedThrough(res), path).toBe(true);
    }
  });

  it("strips a forged verified-origin flag, so client-ip.ts never trusts a direct caller", async () => {
    const { proxy } = await loadProxy({ secret: SECRET });
    const res = await proxy(
      originRequest("/api/health", {
        headers: {
          [VERIFIED_ORIGIN_HEADER]: "1",
          "cf-connecting-ip": "203.0.113.9",
        },
      }),
    );
    expect(passedThrough(res)).toBe(true);
    expect(forwardedVerifiedHeader(res)).toBeNull();
    expect(overriddenHeaders(res)).not.toContain(VERIFIED_ORIGIN_HEADER);
  });

  it("does not re-stamp the flag when the session refresh rebuilds the response", async () => {
    const { proxy } = await loadProxy({ secret: SECRET, supabase: true });
    const res = await proxy(
      originRequest("/api/health", {
        headers: { [VERIFIED_ORIGIN_HEADER]: "1", cookie: "sb-old=1" },
      }),
    );
    expect(passedThrough(res)).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("sb-refreshed=1");
    expect(forwardedVerifiedHeader(res)).toBeNull();
    expect(overriddenHeaders(res)).not.toContain(VERIFIED_ORIGIN_HEADER);
  });
});

describe("proxy origin check — no secret configured (local/dev/preview)", () => {
  it("passes everything through and trusts it, as before", async () => {
    const { proxy } = await loadProxy({ secret: undefined });
    for (const path of ["/", "/shop/x.png", "/api/health"]) {
      const res = await proxy(originRequest(path));
      expect(passedThrough(res), path).toBe(true);
      expect(forwardedVerifiedHeader(res), path).toBe("1");
    }
  });
});
