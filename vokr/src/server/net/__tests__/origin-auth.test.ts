import { describe, expect, it } from "vitest";

import {
  isOriginAuthorized,
  ORIGIN_AUTH_HEADER,
} from "@/server/net/origin-auth";

function requestWithAuthHeader(value: string | undefined): Request {
  return new Request("https://vokr.shop/api/health", {
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
});
