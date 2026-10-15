import { describe, expect, it } from "vitest";

import { redirectTo } from "../redirect";

/**
 * Behind Cloud Run the standalone server sees `https://0.0.0.0:3000` as
 * its own URL, so every redirect built from `request.url` sent visitors
 * nowhere (production, 15 Oct 2026). Redirects are now relative and the
 * browser resolves them against the address it actually requested.
 */
describe("redirectTo", () => {
  it.each(["/", "/sign-in?error=confirm", "/reset-password", "/orders"])("sends %s as a relative Location", (path) => {
    const response = redirectTo(path);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(path);
  });

  it.each(["https://vokr.shop/", "//evil.example", "/\\evil.example", "evil", ""])("refuses %j — never an open redirect", (path) => {
    expect(() => redirectTo(path)).toThrow(/not a same-site path/);
  });
});
