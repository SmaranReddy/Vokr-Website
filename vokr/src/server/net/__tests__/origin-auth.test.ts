import { describe, expect, it } from "vitest";

import {
  isOriginAuthorized,
  ORIGIN_AUTH_HEADER,
} from "@/server/net/origin-auth";

/**
 * `/cart` rather than `/api/health`: the health path is deliberately
 * exempt (Cloud Run's startup probe, the pipeline smoke test and the
 * keep-warm job all call it directly, with no Worker header), so it
 * would pass every assertion below for the wrong reason.
 */
function requestWithAuthHeader(
  value: string | undefined,
  path = "/cart",
): Request {
  return new Request(`https://vokr.shop${path}`, {
    headers: value !== undefined ? { [ORIGIN_AUTH_HEADER]: value } : {},
  });
}

describe("isOriginAuthorized", () => {
  it("passes every request when no secret is configured (local/dev/preview)", () => {
    expect(isOriginAuthorized(requestWithAuthHeader(undefined), undefined)).toBe(
      true,
    );
    expect(isOriginAuthorized(requestWithAuthHeader("anything"), undefined)).toBe(
      true,
    );
    expect(isOriginAuthorized(requestWithAuthHeader(""), "")).toBe(true);
  });

  it("passes when the header matches the configured secret exactly", () => {
    const request = requestWithAuthHeader("s3cret");
    expect(isOriginAuthorized(request, "s3cret")).toBe(true);
  });

  it("refuses when the header is missing but a secret is configured", () => {
    const request = requestWithAuthHeader(undefined);
    expect(isOriginAuthorized(request, "s3cret")).toBe(false);
  });

  it("refuses when the header value does not match — the run.app bypass D9 closes", () => {
    const request = requestWithAuthHeader("forged-by-client");
    expect(isOriginAuthorized(request, "s3cret")).toBe(false);
  });

  it("exempts /api/health, so Cloud Run's startup probe still passes", () => {
    // Removing this exemption fails the probe (httpGet /api/health), so
    // the revision never goes ready and the deploy rolls back.
    const probe = requestWithAuthHeader(undefined, "/api/health");
    expect(isOriginAuthorized(probe, "s3cret")).toBe(true);
  });

  it("exempts only the exact health path, not paths that merely start with it", () => {
    for (const path of ["/api/health/../admin", "/api/healthz", "/api/health2"]) {
      expect(isOriginAuthorized(requestWithAuthHeader(undefined, path), "s3cret")).toBe(
        false,
      );
    }
  });

  it("ignores the query string when matching the exemption", () => {
    const probe = requestWithAuthHeader(undefined, "/api/health?probe=1");
    expect(isOriginAuthorized(probe, "s3cret")).toBe(true);
  });
});
