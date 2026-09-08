import { describe, expect, it } from "vitest";

import { getClientIp } from "@/server/net/client-ip";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://vokr.shop/api/auth/signin", { headers });
}

describe("getClientIp", () => {
  it("prefers cf-connecting-ip over every other header", () => {
    const request = requestWithHeaders({
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2, 3.3.3.3",
      "x-real-ip": "4.4.4.4",
    });
    expect(getClientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to the first hop of x-forwarded-for", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "2.2.2.2, 3.3.3.3",
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("trims whitespace from the first x-forwarded-for hop", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "  2.2.2.2  , 3.3.3.3",
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to x-real-ip when nothing else is present", () => {
    const request = requestWithHeaders({ "x-real-ip": "4.4.4.4" });
    expect(getClientIp(request)).toBe("4.4.4.4");
  });

  it("returns 'unknown' rather than throwing when no header is present", () => {
    const request = requestWithHeaders({});
    expect(getClientIp(request)).toBe("unknown");
  });
});
