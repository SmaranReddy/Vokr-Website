// R10 over real HTTP (plan §5 Phase 21, tasks 1–4): N buyers, each a
// separate guest, all try to buy the same variant with a small known
// stock. Each buyer walks the real API path — add to bag, open a checkout
// session, give an address, price it — and then every buyer fires the
// reservation at the same instant (a start barrier from setup()).
//
// Stops at the reservation. The next step, `POST /api/payments/razorpay/order`,
// calls api.razorpay.com (the base URL is not configurable) and needs
// Razorpay test keys; the webhook step needs the webhook secret. Both wait
// for R5 (staging) and the owner's sandbox keys.
//
// Thresholds come only from the plan (Phase 21 task 4 table, R10 row):
//   - 0 % 5xx; a sold-out answer is a 409, never a 500
//   - successful reservations == min(N, stock); clean denials == N - stock
//   - p95 checkout under 3 s
// 429s are counted on their own (`rate_limited_429`), never as success.
// The database half (oversell, duplicates, deadlocks, leaks) is
// `load-tests/db.ts verify`, run after every k6 run.
//
// EDGE_SECRET: production traffic arrives through the Cloudflare Worker,
// which stamps the origin-auth secret and the buyer's own IP
// (`cf-connecting-ip`) — `src/server/net/client-ip.ts` trusts the IP only
// then. On a local server started with ORIGIN_AUTH_SECRET=<throwaway
// value>, setting EDGE_SECRET to the same value makes this script play the
// Worker, giving each buyer its own IP as in production. Without it every
// buyer shares one IP bucket — a real one-IP limit, reported as 429s.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

import { capVus, resolveTarget } from "./lib/target.js";

const BASE_URL = resolveTarget();
const BUYERS = capVus(__ENV.VUS || "10", 50);
const STOCK = Number(__ENV.STOCK || "3");
const VARIANT_ID = __ENV.VARIANT_ID;
const SITE_ORIGIN = __ENV.SITE_ORIGIN || "http://localhost:3000";
const EDGE_SECRET = __ENV.EDGE_SECRET || "";
const RUN_OCTET = Number(__ENV.RUN_OCTET || "1") % 250;
const PREP_SECONDS = Number(__ENV.PREP_SECONDS || "30");
const PINCODE = "411001";
if (!VARIANT_ID) throw new Error("VARIANT_ID is required (from `tsx load-tests/db.ts seed`).");

const serverErrors = new Rate("server_errors");
const rateLimited = new Counter("rate_limited_429");
const granted = new Counter("reserve_granted");
const soldOut = new Counter("reserve_sold_out_409");
const unexpected = new Counter("unexpected_responses");
const prepFailed = new Counter("prep_failed");
const reserveLatency = new Trend("reserve_ms", true);
const journeyLatency = new Trend("checkout_journey_ms", true);

export const options = {
  scenarios: {
    buyers: { executor: "per-vu-iterations", vus: BUYERS, iterations: 1, maxDuration: `${PREP_SECONDS + 60}s` },
  },
  thresholds: {
    server_errors: ["rate==0"],
    reserve_granted: [`count==${Math.min(BUYERS, STOCK)}`],
    reserve_sold_out_409: [`count==${Math.max(BUYERS - STOCK, 0)}`],
    unexpected_responses: ["count==0"],
    // Every buyer must reach the barrier, or the run measured fewer than N.
    prep_failed: ["count==0"],
    reserve_ms: ["p(95)<3000"],
    checkout_journey_ms: ["p(95)<3000"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

export function setup() {
  return { startAt: Date.now() + PREP_SECONDS * 1000 };
}

function headers() {
  const result = { "content-type": "application/json", origin: SITE_ORIGIN };
  if (EDGE_SECRET) {
    result["x-vokr-origin-auth"] = EDGE_SECRET;
    result["cf-connecting-ip"] = `10.${RUN_OCTET}.${Math.floor(__VU / 250)}.${__VU % 250}`;
  }
  return result;
}

// The guest cookie is `Secure`; k6's jar will not replay it over plain
// http to localhost, so it is carried by hand, exactly as issued.
let guestCookie = null;

function call(method, path, body, name) {
  const params = { headers: headers(), tags: { name } };
  if (guestCookie) params.cookies = { vokr_guest: { value: guestCookie, replace: true } };
  const response = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), params);
  serverErrors.add(response.status >= 500);
  if (response.status === 429) rateLimited.add(1);
  const issued = response.cookies.vokr_guest;
  if (issued && issued.length > 0) guestCookie = issued[0].value;
  return response;
}

function errorCode(response) {
  try {
    return response.json("error.code");
  } catch {
    return null;
  }
}

export default function buyer(data) {
  const prepStarted = Date.now();
  let response = call("POST", "/api/cart/items", { variantId: VARIANT_ID, quantity: 1 }, "cart_add");
  if (!check(response, { "cart add 200": (r) => r.status === 200 })) {
    prepFailed.add(1, { step: "cart_add", status: String(response.status) });
    return;
  }
  response = call("POST", "/api/checkout/session", { idempotencyKey: `load-${RUN_OCTET}-${__VU}-${Date.now()}` }, "session_create");
  if (!check(response, { "session 201": (r) => r.status === 201 })) {
    prepFailed.add(1, { step: "session_create", status: String(response.status) });
    return;
  }
  const sessionId = response.json("checkoutSession.id");
  response = call(
    "PUT",
    `/api/checkout/session/${sessionId}/address`,
    {
      name: `Load Buyer ${__VU}`,
      phone: "9876543210",
      line1: "1 Load Test Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: PINCODE,
      email: `buyer${__VU}@load.invalid`,
    },
    "address",
  );
  if (!check(response, { "address 200": (r) => r.status === 200 })) {
    prepFailed.add(1, { step: "address", status: String(response.status) });
    return;
  }
  response = call("GET", `/api/checkout/session/${sessionId}/pricing?paymentMethod=prepaid`, undefined, "pricing");
  if (!check(response, { "pricing 200": (r) => r.status === 200 })) {
    prepFailed.add(1, { step: "pricing", status: String(response.status) });
    return;
  }
  const prepMs = Date.now() - prepStarted;

  // Barrier: every buyer reserves at the same instant.
  const wait = (data.startAt - Date.now()) / 1000;
  if (wait > 0) sleep(wait);
  else prepFailed.add(1, { step: "missed_barrier", status: "late" });

  response = call("POST", `/api/checkout/session/${sessionId}/reserve`, undefined, "reserve");
  reserveLatency.add(response.timings.duration);
  journeyLatency.add(prepMs + response.timings.duration);
  if (response.status === 200) granted.add(1);
  else if (response.status === 409 && errorCode(response) === "OUT_OF_STOCK") soldOut.add(1);
  else unexpected.add(1, { status: String(response.status), code: String(errorCode(response)) });
}
