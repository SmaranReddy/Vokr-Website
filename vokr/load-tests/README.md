# Load tests (plan §5 Phase 21, R10)

k6 scripts that drive the real application over HTTP, plus a database
verifier for the facts HTTP cannot show. Results: `docs/performance/results.md`.

| File | What it does |
|---|---|
| `browse.js` | Anonymous browse: homepage, PDPs, catalog API, a support page. GET-only allowlist, ≤ 50 VUs, ≤ 300 s. |
| `checkout-concurrency.js` | R10: N guests buy one variant with small stock. Cart → session → address → pricing, then every buyer reserves at the same instant. Stops before Razorpay. |
| `db.ts` | `seed` a fresh variant with known stock · `sample-locks` while k6 runs · `verify` oversell, duplicate holds, reserved-counter integrity, deadlocks, and leaks after the real expiry job. |
| `lib/target.js` | Refuses any non-local host unless `ALLOW_REMOTE_TARGET=<exact host>`. Always refuses `vokr.shop`, Supabase, both production Cloud Run URLs and any run.app host of a service named `vokr-…` (including revision tags), even when allowed. |

**Never point these at production.** Not even `browse.js`: the plan names
Supabase egress (HTTP 402 on every service) as the sharpest risk in the stack.

## Running locally

k6 runs from the pinned Docker image (no npm dependency). `npm` from PowerShell.

1. An isolated database: `create database vokr_load` on the Compose Postgres
   (port 55432), then `prisma migrate deploy` and `prisma db seed` with
   `DATABASE_URL=postgresql://vokr:vokr_local_dev@localhost:55432/vokr_load`.
   `db.ts` refuses any database that is not local or whose name lacks `load`.
2. A production build (`npm run build`, then `node .next/standalone/server.js`
   with `PORT=3000` — the server Cloud Run runs; `next start` warns under
   `output: "standalone"`) with that
   `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, placeholder
   `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` (guests never call Supabase: with no
   session cookie `getUser()` answers locally), and for checkout a throwaway
   `ADDRESS_ENCRYPTION_KEY` plus local-only `CHECKOUT_SELLER_STATE` /
   `CHECKOUT_*_FEE_PAISE` values (D3/D11 placeholders — never real config).
3. Browse:
   ```sh
   docker run --rm -v "<abs>/load-tests:/scripts:ro" grafana/k6:0.57.0 run \
     -e VUS=25 -e DURATION=60s /scripts/browse.js
   ```
4. Checkout (needs a build with ordering enabled — see below):
   ```sh
   npx tsx load-tests/db.ts seed --stock 3            # prints variantId
   npx tsx load-tests/db.ts sample-locks --seconds 60 # in parallel with k6
   docker run --rm -v "<abs>/load-tests:/scripts:ro" grafana/k6:0.57.0 run \
     -e VUS=50 -e STOCK=3 -e VARIANT_ID=<id> -e EDGE_SECRET=<ORIGIN_AUTH_SECRET> \
     -e RUN_OCTET=<1..249> /scripts/checkout-concurrency.js
   npx tsx load-tests/db.ts verify --variant <id> --buyers 50 --granted <k6 reserve_granted>
   ```
   `EDGE_SECRET` makes k6 play the Cloudflare Worker (origin-auth header +
   one `cf-connecting-ip` per buyer), which is how production traffic
   arrives. Without it, all buyers share one IP bucket and the per-IP
   checkout limits (60 mutations / 20 reservations per 5 min) answer 429 —
   a real limit, counted as `rate_limited_429`, never as success.

## The ordering gate

`ORDERING_ENABLED` is a hardcoded `false` (`src/config/commerce.ts`) by design:
enabling it is a reviewed code change. Against a normal build the checkout
script proves the gate holds under load (every cart call 403, zero 5xx).
The real R10 run needs a build where it is `true` — on an isolated
environment only (R5 staging, or a local build the owner explicitly
authorizes). Never commit that change.

How the owner-authorized local run of 17 Oct 2026 did it (`docs/performance/results.md`):
a throwaway **detached** worktree (`git worktree add --detach`), the flip as
an uncommitted edit there, a launcher that unsets every provider key and
refuses any `DATABASE_URL` other than `localhost:55432/vokr_load`, the
standalone server under `cmd` redirection (in PowerShell,
`$ErrorActionPreference = 'Stop'` kills `node` on its first stderr line), and
the worktree removed afterwards.

## Against staging (R5), later

Deploy staging as its **own Cloud Run service whose name does not start with
`vokr`** (e.g. `staging-vokr`) — the guard refuses the production service
`vokr` and every `vokr-…` run.app host by design. Then set
`BASE_URL=https://<staging host>` and `ALLOW_REMOTE_TARGET=<staging host>` (exact match),
`SITE_ORIGIN` to the staging origin, `EDGE_SECRET` to staging's
origin-auth secret (if a Worker fronts it). `db.ts` writes rows and today
refuses any non-local database; widening that to staging's own database is
a reviewed change, never an environment toggle.
To go past the reservation, staging needs Razorpay **test** keys and a
webhook secret, and the script needs the order + webhook steps added.
