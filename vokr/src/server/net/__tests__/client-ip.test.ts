import { describe, expect, it } from "vitest";

import { getClientIp } from "@/server/net/client-ip";
import { VERIFIED_ORIGIN_HEADER } from "@/server/net/origin-auth";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://vokr.shop/api/auth/signin", { headers });
}

function verifiedRequestWithHeaders(headers: Record<string, string>): Request {
  return requestWithHeaders({ ...headers, [VERIFIED_ORIGIN_HEADER]: "1" });
}

describe("getClientIp", () => {
  it("prefers cf-connecting-ip over every other header, once the origin is verified", () => {
    const request = verifiedRequestWithHeaders({
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2, 3.3.3.3",
      "x-real-ip": "4.4.4.4",
    });
    expect(getClientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to the first hop of x-forwarded-for, once the origin is verified", () => {
    const request = verifiedRequestWithHeaders({
      "x-forwarded-for": "2.2.2.2, 3.3.3.3",
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("trims whitespace from the first x-forwarded-for hop, once the origin is verified", () => {
    const request = verifiedRequestWithHeaders({
      "x-forwarded-for": "  2.2.2.2  , 3.3.3.3",
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to x-real-ip when nothing else is present, once the origin is verified", () => {
    const request = verifiedRequestWithHeaders({ "x-real-ip": "4.4.4.4" });
    expect(getClientIp(request)).toBe("4.4.4.4");
  });

  it("returns 'unknown' rather than throwing when no header is present", () => {
    const request = verifiedRequestWithHeaders({});
    expect(getClientIp(request)).toBe("unknown");
  });

  it("returns 'unknown' for a forged cf-connecting-ip when the origin is not verified (R13)", () => {
    const request = requestWithHeaders({
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2",
      "x-real-ip": "4.4.4.4",
    });
    expect(getClientIp(request)).toBe("unknown");
  });

  it("returns 'unknown' when the verified-origin header is present but not exactly '1'", () => {
    const request = requestWithHeaders({
      "cf-connecting-ip": "1.1.1.1",
      [VERIFIED_ORIGIN_HEADER]: "true",
    });
    expect(getClientIp(request)).toBe("unknown");
  });
});
