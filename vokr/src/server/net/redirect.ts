import { NextResponse } from "next/server";

/**
 * A redirect to a path on this site, sent as a **relative** `Location`
 * (RFC 9110 §10.2.2) so the browser resolves it against the URL it
 * actually requested — `https://vokr.shop/...`.
 *
 * Never build a redirect from `request.url`: behind Cloud Run the
 * standalone server sees its own bind address there
 * (`https://0.0.0.0:3000`), and every redirect built from it sent real
 * visitors nowhere (found in production, 15 Oct 2026).
 *
 * Only same-site paths are accepted — `//host` and `/\host` would be
 * read by browsers as another origin — so this can never become an open
 * redirect.
 */
export function redirectTo(path: string, status: 302 | 303 | 307 | 308 = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error(`redirectTo: not a same-site path: ${path}`);
  }
  return new NextResponse(null, { status, headers: { location: path } });
}
