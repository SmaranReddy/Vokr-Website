import { describe, expect, it } from "vitest";

import { checkOrigin, ORIGIN_AUTH_HEADER } from "@/server/net/origin-auth";

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

describe("checkOrigin", () => {
  it("trusts every request when no secret is configured (local/dev/preview)", () => {
    expect(checkOrigin(requestWithAuthHeader(undefined), undefined)).toBe(
      "trusted",
    );
    expect(checkOrigin(requestWithAuthHeader("anything"), undefined)).toBe(
      "trusted",
    );
    expect(checkOrigin(requestWithAuthHeader(""), "")).toBe("trusted");
  });

  it("trusts a request whose header matches the configured secret exactly", () => {
    const request = requestWithAuthHeader("s3cret");
    expect(checkOrigin(request, "s3cret")).toBe("trusted");
  });

  it("refuses when the header is missing but a secret is configured", () => {
    const request = requestWithAuthHeader(undefined);
    expect(checkOrigin(request, "s3cret")).toBe("refused");
  });

  it("refuses when the header value does not match — the run.app bypass D9 closes", () => {
    // No trailing-whitespace case: `Headers` trims it (HTTP OWS), so it
    // would reach this check as the real secret.
    for (const forged of ["forged-by-client", "", "s3cre", "s3cret2", "S3CRET"]) {
      expect(checkOrigin(requestWithAuthHeader(forged), "s3cret")).toBe(
        "refused",
      );
    }
  });

  it("exempts /api/health without trusting it, so Cloud Run's startup probe still passes", () => {
    // Removing this exemption fails the probe (httpGet /api/health), so
    // the revision never goes ready and the deploy rolls back. "exempt",
    // not "trusted": a direct caller's IP headers must still not count.
    const probe = requestWithAuthHeader(undefined, "/api/health");
    expect(checkOrigin(probe, "s3cret")).toBe("exempt");
  });

  it("trusts /api/health when it does carry the secret (the smoke test, via the Worker)", () => {
    const viaWorker = requestWithAuthHeader("s3cret", "/api/health");
    expect(checkOrigin(viaWorker, "s3cret")).toBe("trusted");
  });

  it("exempts only the exact health path, not paths that merely start with it", () => {
    for (const path of [
      "/api/health/../admin",
      "/api/healthz",
      "/api/health2",
      "/api/health.png",
      "/API/health",
    ]) {
      expect(checkOrigin(requestWithAuthHeader(undefined, path), "s3cret")).toBe(
        "refused",
      );
    }
  });

  it("ignores the query string when matching the exemption", () => {
    const probe = requestWithAuthHeader(undefined, "/api/health?probe=1");
    expect(checkOrigin(probe, "s3cret")).toBe("exempt");
  });
});
