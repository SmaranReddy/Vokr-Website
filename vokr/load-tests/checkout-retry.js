// R10 companion scenario: retries and partial rollback over real HTTP.
//
// `checkout-concurrency.js` sends one reserve per single-item session, so
// it cannot show what happens when a buyer double-clicks, or when one line
// of a bag is sold out and another is not. Here every buyer carts two
// variants — the scarce one (STOCK units) and a plentiful companion — and
// at the barrier fires `/reserve` **twice at once** (`http.batch`).
//
// Expected, from the route ("idempotent — repeating the call returns the
// same reservation") and the all-or-nothing reservation transaction:
//   - a winning session answers 200 to both calls; a losing one 409
//     `OUT_OF_STOCK` to both; never one of each
//   - 0 % 5xx
// The facts that matter are in the database (`db.ts verify`, seeded with
// `--companion-stock`): one row per variant per winning session, the
// companion reserved exactly for the winners and never for a loser.
//
// Same target guard, edge mode and plan-sourced thresholds as
// checkout-concurrency.js.

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

import { capVus, resolveTarget } from "./lib/target.js";

const BASE_URL = resolveTarget();
const BUYERS = capVus(__ENV.VUS || "10", 50);
const STOCK = Number(__ENV.STOCK || "3");
const VARIANT_ID = __ENV.VARIANT_ID;
const COMPANION_ID = __ENV.COMPANION_ID;
const SITE_ORIGIN = __ENV.SITE_ORIGIN || "http://localhost:3000";
const EDGE_SECRET = __ENV.EDGE_SECRET || "";
const RUN_OCTET = Number(__ENV.RUN_OCTET || "1") % 250;
const PREP_SECONDS = Number(__ENV.PREP_SECONDS || "30");
if (!VARIANT_ID || !COMPANION_ID) {
  throw new Error("VARIANT_ID and COMPANION_ID are required (from `tsx load-tests/db.ts seed --companion-stock N`).");
}

const serverErrors = new Rate("server_errors");
const rateLimited = new Counter("rate_limited_429");
const sessionsGranted = new Counter("sessions_granted");
const sessionsSoldOut = new Counter("sessions_sold_out");
const inconsistent = new Counter("inconsistent_sessions");
const prepFailed = new Counter("prep_failed");
const reserveLatency = new Trend("reserve_ms", true);

export const options = {
  scenarios: {
    buyers: { executor: "per-vu-iterations", vus: BUYERS, iterations: 1, maxDuration: `${PREP_SECONDS + 60}s` },
  },
  thresholds: {
    server_errors: ["rate==0"],
    sessions_granted: [`count==${Math.min(BUYERS, STOCK)}`],
    sessions_sold_out: [`count==${Math.max(BUYERS - STOCK, 0)}`],
    inconsistent_sessions: ["count==0"],
    prep_failed: ["count==0"],
    reserve_ms: ["p(95)<3000"],
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

let guestCookie = null;

function params(name) {
  const result = { headers: headers(), tags: { name } };
  if (guestCookie) result.cookies = { vokr_guest: { value: guestCookie, replace: true } };
  return result;
}

function record(response) {
  serverErrors.add(response.status >= 500);
  if (response.status === 429) rateLimited.add(1);
  const issued = response.cookies.vokr_guest;
  if (issued && issued.length > 0) guestCookie = issued[0].value;
  return response;
}

function call(method, path, body, name) {
  return record(http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), params(name)));
}

function outcome(response) {
  if (response.status === 200) return "granted";
  try {
    if (response.status === 409 && response.json("error.code") === "OUT_OF_STOCK") return "sold_out";
  } catch {
    // fall through
  }
  return `other:${response.status}`;
}

function step(response, expected, name) {
  if (check(response, { [`${name} ${expected}`]: (r) => r.status === expected })) return true;
  prepFailed.add(1, { step: name, status: String(response.status) });
  return false;
}

export default function buyer(data) {
  if (!step(call("POST", "/api/cart/items", { variantId: VARIANT_ID, quantity: 1 }, "cart_add"), 200, "cart_add")) return;
  if (!step(call("POST", "/api/cart/items", { variantId: COMPANION_ID, quantity: 1 }, "cart_add_companion"), 200, "cart_add_companion")) return;
  let response = call("POST", "/api/checkout/session", { idempotencyKey: `retry-${RUN_OCTET}-${__VU}-${Date.now()}` }, "session_create");
  if (!step(response, 201, "session_create")) return;
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
      pincode: "411001",
      email: `buyer${__VU}@load.invalid`,
    },
    "address",
  );
  if (!step(response, 200, "address")) return;
  if (!step(call("GET", `/api/checkout/session/${sessionId}/pricing?paymentMethod=prepaid`, undefined, "pricing"), 200, "pricing")) return;

  const wait = (data.startAt - Date.now()) / 1000;
  if (wait > 0) sleep(wait);
  else prepFailed.add(1, { step: "missed_barrier", status: "late" });

  // The double click: two reserves for the same session, in flight together.
  const url = `${BASE_URL}/api/checkout/session/${sessionId}/reserve`;
  const [first, second] = http.batch([
    ["POST", url, null, params("reserve")],
    ["POST", url, null, params("reserve")],
  ]);
  for (const response of [first, second]) {
    record(response);
    reserveLatency.add(response.timings.duration);
  }
  const a = outcome(first);
  const b = outcome(second);
  if (a === b && a === "granted") sessionsGranted.add(1);
  else if (a === b && a === "sold_out") sessionsSoldOut.add(1);
  else inconsistent.add(1, { first: a, second: b });
}
