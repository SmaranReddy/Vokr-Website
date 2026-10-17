import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Plan §5 Phase 16, task 4 — the route-by-route audit, enforced. Every
 * route handler under `src/app` must appear here with the methods it
 * exports and the guards its source must call; a new route with no entry,
 * a new method, or a guard that disappears fails CI. "A missing
 * authorisation check is invisible until it is exploited" — this makes it
 * visible at review time instead.
 *
 * Cross-cutting, for every route (enforced in `src/proxy.ts`, tested in
 * `src/server/net/__tests__`): the origin-auth check (direct `run.app`
 * requests refused) and the cross-site check (state-changing `/api/*`
 * requests from another site refused, webhook and maintenance exempt).
 *
 * The human-readable table is `docs/security/route-audit.md`.
 */

type Guard =
  | "ordering-gate" // assertOrderingEnabled(): 403 while the storefront is browse-only
  | "session" // getSession(): resolves a user or guest identity; ownership checked in the service
  | "signed-in" // requireUser(): 401 unless signed in; ownership on every read
  | "rate-limit" // a per-IP / per-identity limit before the work
  | "strict-body" // zod .strict() body / query schema
  | "signature" // HMAC-verified Razorpay webhook
  | "scheduler-oidc" // Cloud Scheduler OIDC token verified in-app
  | "guest-lookup" // lookupGuestOrder(): limits, uniform errors, uniform timing
  | "admin"; // handleAdmin(): verified admin or 404, session age, per-admin rate limit, audit in the service

const GUARD_PATTERNS: Record<Guard, RegExp> = {
  "ordering-gate": /assertOrderingEnabled\(\)/,
  session: /getSession\(request\)/,
  "signed-in": /requireUser\(request\)/,
  "rate-limit": /assertWithinRateLimit\(|assert[A-Za-z]+Allowed\(/,
  "strict-body": /\.strict\(\)|Schema\.safeParse\(|parseJsonBody\(request, [A-Za-z]+Schema\)/,
  signature: /handleRazorpayWebhook\(/,
  "scheduler-oidc": /handleMaintenanceRequest\(/,
  "guest-lookup": /lookupGuestOrder\(/,
  admin: /handleAdmin\(\s*request,/,
};

interface RouteEntry {
  methods: string[];
  guards: Guard[];
  /** Why this route needs no more than the guards listed. */
  why: string;
}

const ROUTES: Record<string, RouteEntry> = {
  "/account": { methods: ["GET"], guards: [], why: "Redirect only; reads the Supabase session, writes nothing." },
  "/api/admin/exports/shiprocket": { methods: ["GET"], guards: ["admin", "strict-body"], why: "Admin only (proxy + handler 404 otherwise); decrypts PII, so the export is audit-logged with its order numbers." },
  "/api/admin/inventory/adjust": { methods: ["POST"], guards: ["admin", "strict-body"], why: "Admin only; row-locked, expected on-hand, never below held units; audit row in the same transaction." },
  "/api/admin/orders/[orderNumber]/refund": { methods: ["POST"], guards: ["admin", "strict-body"], why: "Admin only, signed in within 15 min, order number retyped; full refund of the captured amount via the idempotent payment-issue path; audited." },
  "/api/admin/orders/[orderNumber]/reveal": { methods: ["POST"], guards: ["admin", "strict-body"], why: "Admin only; the PII reveal is audit-logged before the data is returned." },
  "/api/admin/orders/[orderNumber]/transition": { methods: ["POST"], guards: ["admin", "strict-body"], why: "Admin only; the shared order state machine (no `refunded` by assertion); audited." },
  "/api/auth/callback": { methods: ["GET"], guards: [], why: "OAuth code exchange; Supabase verifies the code and PKCE verifier." },
  "/api/auth/confirm": { methods: ["GET"], guards: [], why: "Email-link token_hash verified by Supabase; signup type only." },
  "/api/auth/reset/confirm": { methods: ["GET"], guards: [], why: "Recovery token_hash verified by Supabase; no sign-in side effects." },
  "/api/auth/reset": { methods: ["POST"], guards: ["rate-limit", "strict-body"], why: "Anti-enumeration response; email-send cap." },
  "/api/auth/signin": { methods: ["POST"], guards: ["rate-limit", "strict-body"], why: "Credential check by Supabase; per-IP and per-email limits." },
  "/api/auth/signout": { methods: ["POST"], guards: [], why: "Only ends the caller's own session; cross-site POSTs refused by the proxy." },
  "/api/auth/signup": { methods: ["POST"], guards: ["rate-limit", "strict-body"], why: "Anti-enumeration response; email-send cap." },
  "/api/cart/items/[id]": { methods: ["PATCH", "DELETE"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "PATCH is ordering-gated in the handler; DELETE stays open so a bag can be emptied. Ownership in the cart service." },
  "/api/cart/items": { methods: ["POST"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "Server-side price; client price fields rejected." },
  "/api/cart": { methods: ["GET", "DELETE"], guards: ["session", "rate-limit"], why: "The caller's own bag only." },
  "/api/catalog/products/[slug]": { methods: ["GET"], guards: [], why: "Public catalog read, cached; selected columns only." },
  "/api/catalog/products": { methods: ["GET"], guards: [], why: "Public catalog read, cached; selected columns only." },
  "/api/checkout/session/[id]/address": { methods: ["PUT"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "Ownership: another identity's session is a 404." },
  "/api/checkout/session/[id]/pricing": { methods: ["GET"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "Server-computed snapshot; ownership 404." },
  "/api/checkout/session/[id]/reserve": { methods: ["POST"], guards: ["ordering-gate", "session", "rate-limit"], why: "No body: reserves the session's own snapshot; ownership 404." },
  "/api/checkout/session": { methods: ["POST"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "Idempotency key bound to the caller's identity." },
  "/api/csp-report": { methods: ["POST"], guards: [], why: "Log-only CSP reports: body capped, URLs cut to origin+path, per-instance log budget; no DB, no identity." },
  "/api/health": { methods: ["GET"], guards: [], why: "Trivial indexed Postgres query; no data returned." },
  "/api/jobs/maintenance": { methods: ["POST"], guards: ["scheduler-oidc"], why: "RS256 OIDC: Google issuer, exact audience and service account." },
  "/api/marketing/contact": { methods: ["POST"], guards: ["rate-limit", "strict-body"], why: "Public form; rate limited." },
  "/api/marketing/newsletter": { methods: ["POST"], guards: ["rate-limit", "strict-body"], why: "Public form; rate limited." },
  "/api/orders/[orderNumber]": { methods: ["GET"], guards: ["ordering-gate", "signed-in"], why: "Ownership in the query; another customer's order is the same 404." },
  "/api/orders/lookup": { methods: ["POST"], guards: ["ordering-gate", "guest-lookup"], why: "Limits, uniform errors and timing, constant-time email check inside lookupGuestOrder." },
  "/api/orders": { methods: ["GET"], guards: ["ordering-gate", "signed-in"], why: "Only the caller's orders; cursor follows only their own." },
  "/api/payments/razorpay/order": { methods: ["POST"], guards: ["ordering-gate", "session", "rate-limit", "strict-body"], why: "Amount only from the pricing snapshot; an `amount` field is a 400." },
  "/api/payments/status": { methods: ["GET"], guards: ["ordering-gate", "session", "strict-body"], why: "Read-only; ownership 404; never accepts the browser callback's payment details." },
  "/api/privacy/export": { methods: ["POST"], guards: ["signed-in", "rate-limit"], why: "The caller's own account only; per-account and per-IP limits; POST so cross-site refusal applies; nothing stored." },
  "/api/shipping/serviceability": { methods: ["GET"], guards: ["ordering-gate", "rate-limit", "strict-body"], why: "Unauthenticated by design (no identity needed for a PIN lookup); rate limited per IP; fails closed." },
  "/api/webhooks/razorpay": { methods: ["POST"], guards: ["signature", "rate-limit"], why: "HMAC over the raw body, constant-time; replay-safe by event id." },
};

const APP_DIR = path.resolve(import.meta.dirname, "../../app");

function findRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findRoutes(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** `src/app/(group)/api/x/route.ts` → `/api/x` (route groups do not appear in the URL). */
function urlOf(file: string): string {
  const relative = path.relative(APP_DIR, path.dirname(file)).split(path.sep);
  return "/" + relative.filter((segment) => !/^\(.*\)$/.test(segment)).join("/");
}

const files = findRoutes(APP_DIR);

describe("route inventory (plan §5 Phase 16, task 4)", () => {
  it("every route handler is in the audit, and every audited route exists", () => {
    const found = files.map(urlOf).sort();
    expect(found).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(files.map((file) => [urlOf(file), file] as const))("%s exports exactly the audited methods and calls its guards", (url, file) => {
    const entry = ROUTES[url];
    expect(entry, `${url} is not in the route audit`).toBeDefined();
    if (!entry) return;
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
    expect(methods.sort()).toEqual([...entry.methods].sort());
    for (const guard of entry.guards) {
      expect(source, `${url} must call its ${guard} guard`).toMatch(GUARD_PATTERNS[guard]);
    }
    expect(entry.why.length).toBeGreaterThan(10);
  });
});
