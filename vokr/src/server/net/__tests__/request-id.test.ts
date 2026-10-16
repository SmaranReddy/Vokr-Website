import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ORIGIN_AUTH_HEADER } from "../origin-auth";
import { assignRequestId, REQUEST_ID_HEADER, requestIdOf } from "../request-id";

/** Plan §5 Phase 15, task 5: one id per request, from the proxy to the error body. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("assignRequestId", () => {
  it("uses Cloudflare's cf-ray behind the verified Worker", () => {
    expect(assignRequestId(new Headers({ "cf-ray": "8c1f0a2b3c4d5e6f-BOM" }), true)).toBe("8c1f0a2b3c4d5e6f-BOM");
  });

  it("never trusts cf-ray on an unverified request, or a malformed one", () => {
    expect(assignRequestId(new Headers({ "cf-ray": "8c1f0a2b3c4d5e6f-BOM" }), false)).toMatch(UUID);
    expect(assignRequestId(new Headers({ "cf-ray": "<script>" }), true)).toMatch(UUID);
    expect(assignRequestId(new Headers(), true)).toMatch(UUID);
  });
});

describe("requestIdOf", () => {
  it("returns the proxy-assigned id", () => {
    const request = new Request("https://vokr.shop/api/x", { headers: { [REQUEST_ID_HEADER]: "8c1f0a2b3c4d5e6f-BOM" } });
    expect(requestIdOf(request)).toBe("8c1f0a2b3c4d5e6f-BOM");
  });

  it("never echoes an arbitrary value", () => {
    for (const bad of ["a b c d e f g h", "x".repeat(65), "<img src=x>", "short"]) {
      const request = new Request("https://vokr.shop/api/x", { headers: { [REQUEST_ID_HEADER]: bad } });
      expect(requestIdOf(request)).toMatch(UUID);
    }
    expect(requestIdOf(new Request("https://vokr.shop/api/x"))).toMatch(UUID);
  });
});

describe("src/proxy.ts assigns, forwards and returns the id", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadProxy(secret: string) {
    vi.resetModules();
    vi.stubEnv("ORIGIN_AUTH_SECRET", secret);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://vokr.shop");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    return import("@/proxy");
  }

  it("every response carries x-request-id, and a client-sent id is overwritten", async () => {
    const { proxy } = await loadProxy("");
    const response = await proxy(
      new NextRequest("https://0.0.0.0:3000/api/catalog/products", { headers: { [REQUEST_ID_HEADER]: "spoofed-by-client-123" } }),
    );
    const returned = response.headers.get("x-request-id");
    expect(returned).toMatch(UUID);
    expect(response.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`)).toBe(returned);
  });

  it("behind the verified Worker the id is the cf-ray", async () => {
    const { proxy } = await loadProxy("worker-secret");
    const response = await proxy(
      new NextRequest("https://0.0.0.0:3000/", {
        headers: { [ORIGIN_AUTH_HEADER]: "worker-secret", "cf-ray": "8c1f0a2b3c4d5e6f-BOM" },
      }),
    );
    expect(response.headers.get("x-request-id")).toBe("8c1f0a2b3c4d5e6f-BOM");
  });

  it("the proxy's own refusals carry it too", async () => {
    const { proxy } = await loadProxy("worker-secret");
    const refused = await proxy(new NextRequest("https://0.0.0.0:3000/"));
    expect(refused.status).toBe(404);
    expect(refused.headers.get("x-request-id")).toMatch(UUID);
  });
});

describe("an error body names the same id as the header", () => {
  it("catalog route", async () => {
    vi.doMock("@/server/catalog", () => ({
      listProducts: async () => {
        throw new Error("db down");
      },
    }));
    vi.doMock("@/lib/log", () => ({ logServerError: vi.fn() }));
    vi.resetModules();
    const { GET } = await import("@/app/api/catalog/products/route");
    const response = await GET(
      new Request("https://vokr.shop/api/catalog/products", { headers: { [REQUEST_ID_HEADER]: "8c1f0a2b3c4d5e6f-BOM" } }),
    );
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: { requestId: string } }).error.requestId).toBe("8c1f0a2b3c4d5e6f-BOM");
    vi.doUnmock("@/server/catalog");
    vi.doUnmock("@/lib/log");
  });
});
