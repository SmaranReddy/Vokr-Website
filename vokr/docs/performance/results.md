# Performance and load-test results (plan §5 Phase 21)

Scripts and how to run them: `load-tests/README.md`.

## What this evidence is, and is not

- **Real HTTP against the real application:** a production build of `master`
  at `6d8b200` (`npm run build`), served by Node, driven by k6 v0.57.0 (pinned
  `grafana/k6:0.57.0` Docker image, `host.docker.internal:3000`).
- **One local machine, not Cloud Run.** Intel Core i5-12500H (16 logical
  CPUs), 15.7 GB RAM, Windows 11, Docker Desktop. The server had the whole
  machine; Cloud Run gives one instance 1 vCPU / 512 MiB (`cloud-run.md`) and
  up to 3 instances. Latencies here are a **lower bound**, not a forecast.
- **Local Postgres, not Supabase.** Compose Postgres 17 (port 55432), isolated
  database `vokr_load`: 10 migrations, the real 5-product / 27-variant seed.
  No pooler round-trip and no Supabase egress were measured. Network latency
  to ap-south-1 is absent.
- **Not staging.** No staging environment exists (R5). Nothing was sent to
  `vokr.shop`, `run.app` or Supabase. The scripts refuse those hosts.

## Browse path: 17 Oct 2026

Anonymous shopper loop, about 1 s think time between pages: `/` → `/api/catalog/products`
→ one of three PDPs → `/api/catalog/products/model-x` → `/support-faq`.
GET only. Each run is 60 s of constant VUs.

**Threshold:** zero 5xx (the plan's universal error criterion). **The plan
sets no browse-latency target.** There is no §5.2 traffic profile with
numbers, so latencies are recorded, not judged.

### `next start` (3 runs per level)

| VUs | Run | Requests | req/s | p50 ms | p95 ms | p99 ms | max ms | 5xx | 429 | failed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1 | 1000 | 16.2 | 14.9 | 52.0 | 75.4 | 219.6 | 0 | 0 | 0 % |
| 10 | 2 | 1000 | 16.2 | 15.0 | 47.2 | 86.0 | 136.3 | 0 | 0 | 0 % |
| 10 | 3 | 1000 | 16.2 | 14.1 | 52.8 | 72.3 | 205.0 | 0 | 0 | 0 % |
| 25 | 1 | 2500 | 40.3 | 14.5 | 52.0 | 161.5 | 218.5 | 0 | 0 | 0 % |
| 25 | 2 | 2500 | 40.5 | 12.4 | 42.7 | 89.1 | 181.9 | 0 | 0 | 0 % |
| 25 | 3 | 2500 | 40.0 | 19.8 | 75.9 | 115.8 | 185.7 | 0 | 0 | 0 % |
| 50 | 1 | 5000 | 80.1 | 14.6 | 68.5 | 119.7 | 346.1 | 0 | 0 | 0 % |
| 50 | 2 | 5000 | 80.2 | 15.0 | 60.2 | 109.5 | 358.5 | 0 | 0 | 0 % |
| 50 | 3 | 5000 | 79.9 | 14.0 | 54.7 | 144.4 | 292.1 | 0 | 0 | 0 % |

### `node .next/standalone/server.js`, the server Cloud Run runs (parity runs)

| VUs | Run | Requests | req/s | p50 ms | p95 ms | p99 ms | max ms | 5xx | 429 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1 | 1000 | 16.1 | 16.0 | 51.4 | 104.1 | 194.9 | 0 | 0 |
| 25 | 1 | 2375 | 37.9 | 16.3 | 137.7 | 1253.3 | 1922.9 | 0 | 0 |
| 25 | 2 | 2500 | 40.5 | 12.4 | 57.1 | 86.6 | 149.7 | 0 | 0 |
| 25 | 3 | 2500 | 40.2 | 13.8 | 63.4 | 99.9 | 179.0 | 0 | 0 |
| 50 | 1 | 4970 | 79.2 | 15.7 | 60.5 | 249.0 | 551.7 | 0 | 0 |

The 25-VU run 1 tail (homepage p99 1.6 s, `/support-faq` p99 1.2 s) did not
repeat in two reruns or at 50 VUs, and the server logged no error. It is
unexplained: a host stall is likely, but this was not proven. A Cloud Run
run (staging) is the place to see whether it recurs.

**Per page, `next start`, 50 VUs (p95, ms), runs 1/2/3:** `/` 79.8 / 103.9 / 78.0
(the heaviest page, 80 KB HTML) · PDPs 58–80 · `/api/catalog/products`
48.5–74.4 · `/api/catalog/products/model-x` 28.2–44.5 · `/support-faq` 35.3–49.7.

**Reading:** throughput scales linearly with VUs, so the server was not
saturated. Throughput is set by think time, not capacity. p50 stays at about 15 ms
from 10 to 50 VUs. Zero errors and zero 429s: browse has no rate limit. The
real constraint on browse is **Supabase egress per pageview** (R18), which
local Postgres cannot measure.

## Checkout / R10 over HTTP: **BLOCKED, gate verified instead**

`checkout-concurrency.js` is written and run. N guests (separate cookies) each walk cart → checkout
session → address → pricing. Then a start barrier makes every buyer call
`POST /api/checkout/session/[id]/reserve` at the same instant. `db.ts verify` checks
oversell, duplicate holds, the reserved counter, deadlocks
(`pg_stat_database`) and leaks after the real expiry job. `db.ts sample-locks`
samples lock waiters during the run. Thresholds come only from Phase 21 task 4 and the R10 row:

- 0 % 5xx
- `reserve_granted == min(N, stock)`
- `reserve_sold_out_409 == N − stock`
- no unexpected responses
- every buyer reaches the barrier
- p95 reserve and p95 whole journey under 3 s

**Why it could not run to completion here:**

1. **`ORDERING_ENABLED` is a hardcoded `false`** (`src/config/commerce.ts`, by design: a
   reviewed code change, never config). A local build with it flipped to
   `true`, never committed, was attempted for this run and **refused by the
   session's permission policy**. The flip needs the owner's explicit
   authorization or an isolated staging build (R5).
2. **Past the reservation, Razorpay:** `POST /api/payments/razorpay/order`
   calls `https://api.razorpay.com/v1` (base URL hardcoded in
   `src/server/payments/razorpay.ts`). The R7–R9 fakes are module-level
   injected clients, unusable inside a running server. The order, webhook and
   delayed-Razorpay test (task 5) need staging with Razorpay **test** keys and
   a webhook secret.

**Run against the real build instead (ordering gate on), 17 Oct 2026:** one
fresh variant (stock 3), 10 / 25 / 50 buyers. In every run, every buyer's first
call (`POST /api/cart/items`) answered **403 `ORDERING_UNAVAILABLE`**, with
**0 5xx**, 0 unexpected responses, and p95 205 ms at 50. Database afterwards: 0
cart items, 0 reservations and 0 checkout sessions for the variant;
inventory 3 / 0 (on hand / reserved). k6 exited 99 (thresholds crossed: the gate
held, so nothing was reserved). That is the expected result, and it proves the
gate under concurrent load, not R10.

`db.ts verify --buyers 50 --granted 0` on that variant passed 8 of 9 checks. It
failed exactly the one it should: `held units == min(buyers, stock)`, held 0,
expected 3. So the verifier detects a run that reserved nothing. Deadlocks went 0 → 0;
the expiry job had nothing to release. `sample-locks` ran: 16 samples, 0 lock waiters, idle.

**Unexercised:** the gate stops every buyer at the first call, so the
session, address, pricing and reserve steps of the script have never run
against a live server. Their request bodies and response fields were taken
from the route handlers and zod schemas, not observed. Expect to fix small
things on the first real run.

**Known setup constraint (found by reading the code, to confirm when the run happens):** without
the Cloudflare Worker in front, every buyer shares one IP bucket
(`client-ip.ts` trusts forwarded IPs only behind the origin-auth secret), and
the per-IP limits (60 checkout mutations, 20 reservations per 5 min) would
answer 429 from about the 20th buyer. They are counted as `rate_limited_429`, never as
success. The script's `EDGE_SECRET` mode plays the Worker with a throwaway
local `ORIGIN_AUTH_SECRET` (one `cf-connecting-ip` per buyer), which is how
production traffic arrives. Note also that the counters live in Postgres
(`rate_limit_counters`). The per-IP row is a shared hot row, so lock waits there
belong in the R10 reading.

## Database-level R10 (existing, for comparison)

`src/server/inventory/__tests__/concurrent-buyers.integration.test.ts`:
10 / 25 / 50 concurrent `reserveCheckoutSession` calls, 3 units. Exactly 3
holds, the rest cleanly out of stock, zero lock timeouts or deadlocks. This is
the reservation transaction itself, not HTTP.

## Not yet measured (Phase 21 tasks)

- R10 over HTTP at 10 / 25 / 50 × 3 runs (blocked above)
- Razorpay-delay test (task 5)
- Cloud Run vCPU-seconds and Supabase bytes per pageview (task 6, R18)
- cold start with and without keep-warm (task 7)
- Core Web Vitals, mobile (task 8)
- `EXPLAIN ANALYZE` of hot queries (task 9)
