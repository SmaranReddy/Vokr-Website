import { describe, expect, it, vi } from "vitest";

import { contentSecurityPolicy, createNonce, CSP_REPORT_PATH } from "@/config/csp";

import { LogBudget, MAX_REPORT_BYTES, MAX_VIOLATIONS_PER_REPORT, parseCspReport, readCapped, safeUrl } from "../csp-report";

/** Plan §5 Phase 16, task 2: the enforced, nonce-based CSP and the endpoint that receives its reports. */

describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy("https://abc.supabase.co/", { nonce: "bm9uY2U=" });

  it.each([
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ])("contains %s", (directive) => {
    expect(policy).toContain(directive);
  });

  it("allows Razorpay Checkout, the product CDN and the Supabase project, nothing broader", () => {
    expect(policy).toMatch(/script-src [^;]*https:\/\/checkout\.razorpay\.com/);
    expect(policy).toMatch(/frame-src [^;]*https:\/\/api\.razorpay\.com/);
    expect(policy).toMatch(/img-src [^;]*https:\/\/cdn\.shopify\.com/);
    expect(policy).toMatch(/connect-src [^;]*https:\/\/abc\.supabase\.co(?:\s|;)/);
    expect(policy).not.toMatch(/(?:^|\s)(?:\*|https:)(?:\s|;|$)/);
  });

  it("scripts need the request's nonce; strict-dynamic lets nonced scripts load others", () => {
    const scripts = /script-src ([^;]*)/.exec(policy)?.[1]?.split(" ") ?? [];
    expect(scripts).toEqual(expect.arrayContaining(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]));
    // Kept only as the CSP Level 2 fallback: a browser that understands the nonce ignores it.
    expect(scripts.indexOf("'unsafe-inline'")).toBeGreaterThan(scripts.indexOf("'nonce-bm9uY2U='"));
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it("styles carry no nonce, which would disable 'unsafe-inline' for React style attributes", () => {
    expect(policy).toMatch(/style-src 'self' 'unsafe-inline'(?:;|$)/);
  });

  it("'unsafe-eval' only in development", () => {
    expect(contentSecurityPolicy(undefined, { nonce: "x", dev: true })).toMatch(/script-src [^;]*'unsafe-eval'/);
  });

  it("nonces are 128 random bits and never repeat", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(atob(nonce)).toHaveLength(16);
  });

  it("without a Supabase URL configured, connect-src still stands", () => {
    expect(contentSecurityPolicy(undefined, { nonce: "bm9uY2U=" })).toMatch(/connect-src 'self' https:\/\/checkout\.razorpay\.com/);
  });
});

describe("parseCspReport", () => {
  const legacy = {
    "csp-report": {
      "document-uri": "https://vokr.shop/checkout?session=secret#x",
      "violated-directive": "script-src-elem",
      "effective-directive": "script-src-elem",
      "blocked-uri": "https://evil.example/x.js?token=abc",
      disposition: "report",
    },
  };

  it("reads the legacy report-uri format, cutting URLs to origin + path", () => {
    expect(parseCspReport(JSON.stringify(legacy))).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example/x.js",
        document: "https://vokr.shop/checkout",
        disposition: "report",
      },
    ]);
  });

  it("reads the Reporting API format and ignores other report types", () => {
    const reports = [
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline", documentURL: "https://vokr.shop/" } },
      { type: "deprecation", body: { id: "x" } },
    ];
    expect(parseCspReport(JSON.stringify(reports))).toEqual([
      { directive: "img-src", blocked: "inline", document: "https://vokr.shop/", disposition: "report" },
    ]);
  });

  it(`keeps at most ${MAX_VIOLATIONS_PER_REPORT} violations from one request`, () => {
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src" } }));
    expect(parseCspReport(JSON.stringify(many))).toHaveLength(MAX_VIOLATIONS_PER_REPORT);
  });

  it("garbage is nothing, not an error", () => {
    expect(parseCspReport("not json")).toEqual([]);
    expect(parseCspReport("{}")).toEqual([]);
    expect(parseCspReport("null")).toEqual([]);
  });

  it("safeUrl never keeps a query string or fragment", () => {
    expect(safeUrl("https://vokr.shop/reset-password?code=123#t")).toBe("https://vokr.shop/reset-password");
    expect(safeUrl("eval")).toBe("eval");
    expect(safeUrl("javascript:alert(1)")).toBe("javascript:");
    expect(safeUrl(42)).toBe("none");
  });
});

describe("limits", () => {
  it("the log budget refills each minute", () => {
    const budget = new LogBudget(2);
    expect([budget.take(0), budget.take(1), budget.take(2)]).toEqual([true, true, false]);
    expect(budget.take(60_001)).toBe(true);
  });

  it("an oversized body is never read in full", async () => {
    const big = "x".repeat(MAX_REPORT_BYTES + 1);
    expect(await readCapped(new Request("https://vokr.shop/api/csp-report", { method: "POST", body: big }))).toBeNull();
    expect(await readCapped(new Request("https://vokr.shop/api/csp-report", { method: "POST", body: "{}" }))).toBe("{}");
  });
});

describe("POST /api/csp-report", () => {
  it("logs a cleaned violation and always answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/csp-report/route");
    const response = await POST(
      new Request("https://vokr.shop/api/csp-report", {
        method: "POST",
        body: JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/a.png?u=me@example.com" } }),
      }),
    );
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("blocked=https://x.example/a.png "));
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("me@example.com");
    warn.mockRestore();
    expect((await POST(new Request("https://vokr.shop/api/csp-report", { method: "POST", body: "junk" }))).status).toBe(204);
  });
});
