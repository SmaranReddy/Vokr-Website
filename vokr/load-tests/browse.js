// Browse-path HTTP load (plan §5 Phase 21, task 6): what an anonymous
// shopper does — homepage, a PDP, the catalog API, a support page.
//
// GET only, from a fixed allowlist: nothing here can create a cart, a
// session or an order. VUs are capped at 50 and duration at 5 minutes.
//
// The plan states no browse latency target (there is no §5.2 traffic
// profile with numbers), so the only threshold is the one that applies to
// every path: zero 5xx. Latencies are recorded, not judged.
//
//   docker run --rm -v "$PWD/load-tests:/scripts" grafana/k6:0.57.0 run \
//     -e VUS=25 -e DURATION=60s /scripts/browse.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

import { capVus, resolveTarget } from "./lib/target.js";

const BASE_URL = resolveTarget();
const VUS = capVus(__ENV.VUS || "10", 50);
const DURATION = __ENV.DURATION || "60s";
if (!/^\d+s$/.test(DURATION) || Number(DURATION.slice(0, -1)) > 300) {
  throw new Error(`DURATION must be <= 300s, got "${DURATION}".`);
}

const ALLOWED_PATHS = [
  "/",
  "/shop/model-x",
  "/shop/model-001",
  "/shop/kids-model-123",
  "/api/catalog/products",
  "/api/catalog/products/model-x",
  "/support-faq",
];

const serverErrors = new Rate("server_errors");
const rateLimited = new Counter("rate_limited_429");

export const options = {
  scenarios: {
    browse: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  thresholds: {
    server_errors: ["rate==0"],
    // Empty lists: per-path latency is reported, not judged (no stated target).
    ...Object.fromEntries(ALLOWED_PATHS.map((path) => [`http_req_duration{name:${path}}`, []])),
  },
  summaryTrendStats: ["avg", "min", "med", "p(95)", "p(99)", "max"],
};

function get(path) {
  if (!ALLOWED_PATHS.includes(path)) throw new Error(`Path ${path} is not on the browse allowlist.`);
  const response = http.get(`${BASE_URL}${path}`, { tags: { name: path } });
  serverErrors.add(response.status >= 500);
  if (response.status === 429) rateLimited.add(1);
  check(response, { [`${path} 200`]: (r) => r.status === 200 });
  return response;
}

export default function browse() {
  get("/");
  sleep(1);
  get("/api/catalog/products");
  const pdp = ALLOWED_PATHS[1 + Math.floor(Math.random() * 3)];
  get(pdp);
  sleep(1);
  get("/api/catalog/products/model-x");
  get("/support-faq");
  sleep(1);
}
