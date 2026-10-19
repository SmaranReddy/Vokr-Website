# Rate-limit matrix (plan §5 Phase 16, task 6)

Application layer, read from the code on 19 Oct 2026 (`assertWithinRateLimit` /
`consumeRateLimit`, Postgres `rate_limit_counters`, keys SHA-256 hashed).
The edge layer is `infra/cloudflare/waf-rules.md` (**not applied yet**).

"Plan target" is the Phase 16 table. A deviation is listed, not silently
changed: tightening a live limit is a reviewed decision (see the bottom).

## Every API route

| Route | Method | App-layer limit (code) | Plan target | Status |
|---|---|---|---|---|
| `/api/auth/signin` | POST | 10 / 5 min / IP + 10 / 5 min / email | 5 / 15 min / IP + 10 / hr / email | **looser than plan** |
| `/api/auth/signup` | POST | 5 / hr / IP | 5 / 15 min / IP + 10 / hr / email | per-IP stricter; no per-email bucket |
| `/api/auth/reset` | POST | 5 / hr / IP + 3 / hr / email + 1 / min / email | 3 / hr / email | meets |
| `/api/auth/callback`, `/confirm`, `/reset/confirm` | GET | none (one-time high-entropy `token_hash`, redeemed by Supabase, which limits itself) | — | accepted |
| `/api/auth/signout` | POST | none (no DB write, no email) | — | accepted |
| `/api/orders/lookup` | POST | 20 / 15 min / IP + 10 / hr / order number, 800 ms floor | 5 / 15 min / IP + 10 / **day** / number, **lockout** | **looser than plan** |
| `/api/orders`, `/api/orders/[orderNumber]` | GET | **120 / 5 min / user** (added this PR) | — | was a gap, fixed |
| `/api/cart`, `/api/cart/items`, `/api/cart/items/[id]` | GET/POST/PATCH/DELETE | mutations: 120 / 5 min / IP + 60 / 5 min / identity; GET none | 60 / min / identity | meets (stricter) |
| `/api/checkout/session` | POST | 60 / 5 min / IP + 30 / 5 min / identity | 10 / hr / identity | **looser than plan** |
| `/api/checkout/session/[id]/address`, `/pricing` | PUT/GET | same checkout-mutation buckets | — | meets |
| `/api/checkout/session/[id]/reserve` | POST | 20 / 5 min / IP + 10 / 5 min / identity | 20 / hr / identity | meets per 5 min; looser per hour |
| `/api/shipping/serviceability` | GET | 30 / 5 min / IP | 30 / min / IP | meets (stricter) |
| `/api/payments/razorpay/order` | POST | 30 / 5 min / IP + 10 / 5 min / identity | — | **parked (Razorpay)** |
| `/api/payments/status` | GET | none (ordering-gated, polled by the payment step) | — | **parked (Razorpay)**: add a generous per-session limit when payments resume |
| `/api/webhooks/razorpay` | POST | 600 / 5 min / IP + HMAC signature | — | parked; signature is the control |
| `/api/marketing/contact`, `/newsletter` | POST | 5 / hr / IP | — | meets |
| `/api/privacy/export` | POST | 10 / hr / IP + 5 / hr / user | — | meets |
| `/api/admin/**` | all | 120 / min / admin (`src/server/admin/route.ts`), 404 for non-admins in the proxy | — | meets |
| `/api/catalog/products`, `/[slug]` | GET | none (in-memory `TtlCache`, single-flight) | edge-cached | needs the edge rule (WAF rule 5 bucket) |
| `/api/csp-report` | POST | none; body capped, log volume budgeted (`LogBudget`), no DB | — | accepted |
| `/api/health` | GET | none; exempt from origin-auth by design | — | accepted |
| `/api/jobs/maintenance` | POST | Google OIDC (Scheduler service account) | — | accepted |
| `/api/returns/*` | POST | in PR #49 (per-IP + the order-lookup limits) | 5 / hr / IP | review in #49 |

Tests: each limiter has unit or integration coverage beside it
(`src/server/**/__tests__/*rate-limit*`, `client-ip-bucketing.integration.test.ts`,
`lookup*.test.ts`, auth route tests); the new order-history limit is
`src/server/orders/__tests__/history-rate-limit.test.ts`.

## Owner/reviewer decision: the three looser-than-plan rows

Sign-in, guest order lookup and checkout-session create are looser than
the plan's table. Recommendation: **tighten lookup to the plan
(5 / 15 min / IP, 10 / day / number)** before ordering opens, because it is
unauthenticated and the highest-risk surface. Leave sign-in and session
create as they are until real traffic exists: the edge rules (once
applied) carry the burst limit, and tighter app limits mostly hurt shared
IPs (mobile carrier NAT is common in India). Not changed in this PR.
