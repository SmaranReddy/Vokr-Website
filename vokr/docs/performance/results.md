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

## Checkout / R10 over HTTP, 17 Oct 2026: **executed locally, all 9 runs pass**

**Owner-authorized, local-only.** The owner approved (17 Oct 2026) one local
production build with `ORDERING_ENABLED = true`. That flip was a
working-copy edit in a throwaway detached worktree (`vokr-worktrees\r10-local`,
no branch, at `aa6904f`). It was **never committed** and the worktree was removed
afterwards. `src/config/commerce.ts` on every branch and on `master` is
still `false`, and `RAZORPAY_LIVE_MODE_ALLOWED` is untouched.

**Isolation, checked before anything ran:**
- The launcher refuses to start unless `DATABASE_URL` is `localhost:55432/vokr_load`,
  and refuses if any environment value matches `supabase.co`, `vokr.shop`,
  `run.app`, `rzp_live`, `rzp_test` or `api.brevo`.
- Every provider key is explicitly unset: Razorpay key and secret, webhook
  secret, Brevo, Sentry, R2, the service-role key and Google.
- The worktree has no `.env.local`, so neither Prisma's dotenv nor Next loads
  one. `NEXT_PUBLIC_SUPABASE_URL` is the unroutable `http://127.0.0.1:9`.
- `prisma migrate status` reported `vokr_load` at `localhost:55432`, 10
  migrations, up to date.
- The built bundle contains `supabase.co` only in the CSP allowlist, and
  `vokr.shop` only in email addresses.
- The server bound to `127.0.0.1`. D3 and D11 values (`CHECKOUT_SELLER_STATE`,
  fees) are local placeholders, never real config.
- No payment was created: no Razorpay keys exist in that process, and the run
  stops at the reservation.

**Setup:**
- Standalone server (`node .next/standalone/server.js`, as Cloud Run runs it),
  `NODE_ENV=production`.
- k6 `grafana/k6:0.57.0` in `EDGE_SECRET` mode with a throwaway
  `ORIGIN_AUTH_SECRET`, so each buyer arrives with its own `cf-connecting-ip`,
  as behind the Worker.
- Each run seeds a **fresh variant with 3 units** and clears the rate-limit
  counters. Every buyer walks cart → session → address → pricing, then all
  reserve at one barrier instant.
- `db.ts sample-locks` samples `pg_stat_activity` every 100 ms during each run,
  and `db.ts verify` runs after each one.
- Same machine as the browse runs (i5-12500H, local Postgres 17).

| Buyers | Run | Granted (200) | Sold out (409) | 429 | 5xx | Reserve p50 / p95 / p99 / max (ms) | Journey p50 / p95 / p99 (ms) | All requests p95 / p99 (ms) | Max lock waiters | DB verify |
|---:|---:|---:|---:|---:|---:|---|---|---|---:|---|
| 10 | 1 | 3 | 7 | 0 | 0 | 121 / 126 / 127 / 127 | 543 / 555 / 555 | 191 / 192 | 0 | 10/10 PASS |
| 10 | 2 | 3 | 7 | 0 | 0 | 105 / 110 / 110 / 110 | 398 / 403 / 404 | 107 / 110 | 2 | 10/10 PASS |
| 10 | 3 | 3 | 7 | 0 | 0 | 114 / 118 / 118 / 119 | 391 / 400 / 400 | 116 / 118 | 0 | 10/10 PASS |
| 25 | 1 | 3 | 22 | 0 | 0 | 185 / 198 / 198 / 198 | 767 / 787 / 795 | 198 / 217 | 2 | 10/10 PASS |
| 25 | 2 | 3 | 22 | 0 | 0 | 181 / 192 / 193 / 193 | 758 / 782 / 787 | 192 / 216 | 5 | 10/10 PASS |
| 25 | 3 | 3 | 22 | 0 | 0 | 183 / 199 / 201 / 202 | 751 / 770 / 771 | 199 / 206 | 0 | 10/10 PASS |
| 50 | 1 | 3 | 47 | 0 | 0 | 311 / 344 / 344 / 345 | 1461 / 1505 / 1508 | 361 / 373 | 8 | 10/10 PASS |
| 50 | 2 | 3 | 47 | 0 | 0 | 294 / 322 / 324 / 325 | 1325 / 1356 / 1361 | 322 / 349 | 4 | 10/10 PASS |
| 50 | 3 | 3 | 47 | 0 | 0 | 283 / 311 / 313 / 314 | 1781 / 1839 / 1844 | 578 / 592 | 3 | 10/10 PASS |

- **Journey** is the buyer's own steps (cart → session → address → pricing)
  plus the reserve. The barrier wait is excluded.
- **"All requests"** covers every HTTP call in the run (5 per buyer).
- k6's `http_req_failed` (14.0 / 17.6 / 18.8 %) is exactly the share of 409
  sold-out answers, which k6 counts as failed because they are 4xx. They are
  correct denials, not errors.
- Requests/s (1.7 / 4.2 / 8.3) only reflects the barrier design, not capacity.

**Every k6 threshold passed in all 9 runs (exit 0):**
- 0 % 5xx
- granted == min(N, 3)
- sold-out == N − 3, each a 409 `OUT_OF_STOCK`
- 0 unexpected responses
- 0 buyers failed before the barrier
- p95 reserve < 3 s, and p95 journey < 3 s (worst: 1.84 s at 50)

**`db.ts verify`, 10 checks, all PASS in all 9 runs:**
- on-hand unchanged and never negative
- reserved ≤ on-hand (no oversell)
- held units == min(N, stock)
- reserved counter == held rows
- one hold row of one unit per session (no duplicates)
- refused buyers left **no** reservation rows
- k6 200s == held sessions
- zero orders without payment
- `pg_stat_database.deadlocks` unchanged (**0 deadlocks**)
- **zero leaks after expiry:** holds backdated, the real `expireReservations`
  job run, then 0 held and `quantity_reserved` 0, with 0 job errors

**Server log, independently:** 27 `[inventory] GRANT` lines (9 × 3) and 228
`DENY` lines (3 × (7 + 22 + 47)). No error, unhandled rejection, deadlock or
connection error.

**Reading:**
- The reservation is correct under real HTTP concurrency at every level.
- Contention is visible but small: at most 8 sessions waiting on a lock in any
  100 ms sample at 50 buyers. Reserve p95 grows roughly linearly with buyers
  (≈ 120 → 195 → 325 ms), which is the serialisation on the hot inventory row
  the plan predicts, not a cliff.
- The journey p95 at 50 (1.4–1.8 s) is dominated by 50 buyers doing their
  first four steps at once on one machine. It is under the plan's 3 s on this
  hardware, but Cloud Run's 1 vCPU / 512 MiB will be slower. That has to be
  measured there.

**One harness fault, fixed and rerun:** the first matrix attempt lost its
server mid-run. The PowerShell launcher had `$ErrorActionPreference = 'Stop'`,
which turns the server's first stderr line (the expected `OUT_OF_STOCK`
warning) into a terminating error and kills `node`. This is an artefact of the
launcher, not the app. The server was relaunched under `cmd` redirection, and
the whole 9-run matrix was rerun from scratch on fresh variants. Only the
rerun is reported. The aborted run's 3 holds sat on their own variant and were
expired by the next `verify`.

### Still not measured for R10 (incomplete, not passed)

- **Razorpay round-trip.** Neither `POST /api/payments/razorpay/order` nor the
  verified webhook → order creation was run, and neither was the injected
  Razorpay delay (task 5, proving the call is outside the lock). So the R10
  row's "duplicate orders" and "payment/order consistency at every level" are
  **not evidenced over HTTP**. They need staging (R5) with Razorpay **test**
  keys and a webhook secret: the API base is hardcoded, and the existing fakes
  are module-level.
- **Cloud Run performance.** One local machine with the whole CPU, local
  Postgres with no pooler, no network to ap-south-1. Latencies are a lower
  bound. The 3 s p95 has to be re-measured on staging with Cloud Run's
  1 vCPU / 512 MiB and Supabase's pooler.
- **Without the Worker** (an ordinary single-IP client), buyers past the
  per-IP limits (20 reservations / 60 mutations per 5 min) get 429. That was
  not exercised here, because every buyer had its own IP as in production.

## Database-level R10 (existing, for comparison)

`src/server/inventory/__tests__/concurrent-buyers.integration.test.ts`:
10 / 25 / 50 concurrent `reserveCheckoutSession` calls, 3 units. Exactly 3
holds, the rest cleanly out of stock, zero lock timeouts or deadlocks. This is
the reservation transaction itself, not HTTP.

## Not yet measured (Phase 21 tasks)

- R10 Razorpay round-trip (order + webhook) over HTTP, and R10 on Cloud Run (see above)
- Razorpay-delay test (task 5)
- Cloud Run vCPU-seconds and Supabase bytes per pageview (task 6, R18)
- cold start with and without keep-warm (task 7)
- Core Web Vitals, mobile (task 8)
- `EXPLAIN ANALYZE` of hot queries (task 9)
