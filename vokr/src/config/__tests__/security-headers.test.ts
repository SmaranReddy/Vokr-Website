import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import { SECURITY_HEADERS } from "../security-headers";

/** Plan §5 Phase 16, task 1: every response carries the security headers. */
describe("security headers", () => {
  it("apply to every path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([{ source: "/:path*", headers: [...SECURITY_HEADERS] }]);
  });

  it("HSTS is one year, without includeSubDomains or preload (owner decision)", () => {
    const hsts = SECURITY_HEADERS.find((header) => header.key === "Strict-Transport-Security")?.value;
    expect(hsts).toBe("max-age=31536000");
  });

  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Cross-Origin-Opener-Policy", "same-origin-allow-popups"],
  ])("%s: %s", (key, value) => {
    expect(SECURITY_HEADERS.find((header) => header.key === key)?.value).toBe(value);
  });

  it("Permissions-Policy denies device features and allows payment only for this site and Razorpay", () => {
    const policy = SECURITY_HEADERS.find((header) => header.key === "Permissions-Policy")?.value ?? "";
    for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) expect(policy).toContain(feature);
    expect(policy).toContain('payment=(self "https://checkout.razorpay.com")');
  });
});
