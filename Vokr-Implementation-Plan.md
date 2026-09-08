# Vokr Production Implementation Plan

**Living document.** This is the canonical engineering reference for taking
Vokr from its current foundation to a genuinely production-ready
e-commerce product. It is updated as work lands — each phase's `### Status`
block and the master checklist below are the source of truth for progress.

| | |
|---|---|
| **Plan version** | 1.0 |
| **Created** | 7 September 2026 |
| **Authoritative architecture** | `Vokr-Zero-Cost-Production-Tech-Stack-and-Readiness-Checklist.pdf` v1.0 · 7 Sep 2026 |
| **Application root** | `vokr/` |
| **Repository** | github.com/SmaranReddy/Vokr-Website · branch `master` |

---

## 0. Plan Status

| Field | Value |
|---|---|
| **Current phase** | Phase 3 — Authentication + Guest Sessions (not started) |
| **Current status** | Phase 2 COMPLETE (8 Sep 2026) |
| **Latest relevant commit** | `733eb4f` Phase 2: catalog + database — Prisma, schema, migration, seed, catalog service, API routes |
| **Blocking issues** | D1 RESOLVED (8 Sep 2026) — see §0.3. 2 open human decisions remain (D2, D3), plus one open human *task*: the real Supabase project (Phase 2 used local Postgres instead — see Phase 2 Status). **D2 does not block Phase 2 or Phase 3** — the schema defers GST rate/HSN via a nullable `gst_rate_bps` plus a trigger that refuses to let any variant go active without one. D2 blocks R11 (compliant invoicing) and therefore live sales. |
| **Launch gate** | NOT PASSED. 0 of 22 blocking requirements verified. |

### 0.1 Master checklist

- [x] **Phase 0** — Current-State Audit + Foundation Corrections
- [x] **Phase 1** — Foundation Stabilization
- [x] **Phase 2** — Catalog + Database (real Supabase project still open — see Phase 2 Status)
- [ ] **Phase 3** — Authentication + Guest Sessions
- [ ] **Phase 4** — Website / Page Migration
- [ ] **Phase 5** — Server-Side Cart
- [ ] **Phase 6** — Address + Checkout Foundation
- [ ] **Phase 7** — Razorpay Payments
- [ ] **Phase 8** — Inventory + Concurrency Hardening
- [ ] **Phase 9** — Orders
- [ ] **Phase 10** — Fulfilment + COD + Shiprocket Operations
- [ ] **Phase 11** — Transactional Email
- [ ] **Phase 12** — Admin / Operations
- [ ] **Phase 13** — Search + Catalog Performance
- [ ] **Phase 14** — R2 + Asset Migration
- [ ] **Phase 15** — Observability + Logging
- [ ] **Phase 16** — Security + Abuse Protection
- [ ] **Phase 17** — DPDP / Privacy / Data Lifecycle
- [ ] **Phase 18** — Backups + Restore
- [ ] **Phase 19** — CI/CD + Artifact Registry
- [ ] **Phase 20** — Cloud Run + Cloudflare Production Deployment
- [ ] **Phase 21** — Performance + Load Testing
- [ ] **Phase 22** — Production Hardening
- [ ] **Phase 23** — Final Launch Certification
- [ ] **Final production certification** (§13 — every R1–R22 verified with evidence)

### 0.2 Verification evidence log

Every completed phase appends a row. "Evidence" means an artefact someone
else can re-check: a commit SHA, a test run, a screenshot, a provider
dashboard, a restore log. Not an assertion.

| Phase | Completed | Commit | Evidence |
|---|---|---|---|
| 0 | 7 Sep 2026 | *(Phase 0 correction commit)* | `npm run lint`, `npm run typecheck`, `npm run build` all pass from a clean checkout with `.next/` deleted; `.next/standalone` produced at 29 MB |
| 1 | 7 Sep 2026 | `ffb8eb9` (Prettier formatting pass), *(Phase 1 commit)* | `npm run verify` (lint + typecheck + test + build) green from a clean `.next/`; 17/17 tests passing across 4 files; `next dev` boots and serves `GET /` → 200; a deliberately invalid `NEXT_PUBLIC_SITE_URL` makes `src/lib/env.ts` throw one aggregated, readable error before any request is served (reproduced via `npx tsx -e "require('./src/lib/env.ts')"`); `grep` of `.next/static` for every server-only secret name (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`, `R2_SECRET_ACCESS_KEY`, `SENTRY_AUTH_TOKEN`) returns zero matches |
| 2 | 8 Sep 2026 | `733eb4f` | `npm run verify` green from a clean `.next/` (37/37 unit tests, 7 files); `npm run test:integration` green against Compose Postgres (8/8 tests: idempotent seed at 5/27/27 rows twice, all three `inventory` CHECK constraints, duplicate-`sku` rejection, GST-trigger reject/allow round-trip, RLS enabled on all three tables); manual `psql` reproduction of every constraint and the trigger, independent of the test suite; `next dev` + `curl` against both live catalog routes (200 with exact selected fields, 404 with the typed error contract for an unknown slug); `grep` of `.next/static` for `DATABASE_URL`, `DIRECT_URL`, `vokr_local_dev` returns zero matches |

### 0.3 Open decisions requiring a human

These block the phases named. They are product, tax and legal calls rather
than engineering ones, and this plan deliberately does not guess.

| # | Decision | Blocks | Why it cannot be decided here |
|---|---|---|---|
| **D1** | ~~Are gift cards sold at launch?~~ **RESOLVED (8 Sep 2026): NO.** Gift cards are deferred from launch entirely. The gift-card feature is not displayed anywhere on the website — no page, no nav/footer link, no PDP — and no purchasing, redemption or store-credit-ledger functionality is implemented. The launch catalog is **five** SKUs, not six. See §3.6 and §10A. | *(resolved — no longer blocks anything)* | Commercial decision made by the business owner. Stronger than the plan's original recommendation (a): the page itself is withheld, not merely made unpurchasable. |
| **D2** | **GST rate and HSN code per SKU.** ₹295 laces, ₹495 socks and ₹9,995 shoes are not necessarily in one slab. | R11 (compliant invoicing), and therefore live sales | R11 explicitly says "confirm current footwear slabs with your CA". Inventing a rate is a tax error, not a bug. **Does not block Phase 2** — the schema (§3.5, §3.6) stores `gst_rate_bps` as nullable per product with a `CHECK`/seed-time assertion that refuses an active variant with no rate, so catalog and database work proceeds now and an unanswered D2 fails loudly rather than shipping an invented rate. |
| **D3** | **Legal entity, PAN, GST registration and bank account** for Razorpay live-mode KYC (R16), plus the registered address printed on tax invoices (R11). | Phase 7 live mode, Phase 23 | Requires the business owner. Test mode works immediately; live mode does not. **Longest lead time in the programme — start now.** |

---

## 1. Project Mission

Vokr is an Indian D2C footwear brand. It currently exists as 27 standalone
static HTML pages in which **every commercial behaviour is simulated**: the
cart is an in-memory JavaScript array, prices come from DOM attributes,
sign-in accepts any string, there is no inventory, and all 67 forms are
`onsubmit="return false;"`. There is no backend of any kind — the legacy
codebase contains zero `fetch()` calls.

The mission is to replace that with one deployable Next.js application that
can take real money for real stock and be operated by a small team, on
infrastructure costing roughly ₹250–400/month.

Three properties define success, in priority order:

1. **It must not take money it cannot honour.** No overselling, no
   double-charging, no order that exists on one side of the payment
   boundary and not the other.
2. **It must not fail silently.** The two highest-risk items in the whole
   programme — R12 (Supabase Auth SMTP) and R10 (checkout concurrency) —
   both fail *quietly*: a customer receives no email, or two customers are
   both sold the last pair. Both are closed by measurement, never by
   inspection.
3. **It must honour what the site already promises.** `terms.html` is a
   contract. COD, PIN serviceability, 30-day returns with "no login
   required", refunds in 5–7 business days, GST-inclusive pricing and a
   statutory `grievance@` address are commitments already published. The
   backend honours them, or the copy changes. Silence is not an option.

**Scope discipline.** This plan builds what the PDF specifies and nothing
else. Business requirements come from the PDF, the legacy site and
`vokr-backend-scope.docx` — never from invention. Where sources disagree,
§11 records the conflict and the resolution.

---

## 2. Current Repository State

*Audited 7 September 2026 against the working tree and `git log`, not
against documentation.*

### 2.1 Repository layout

```
Vokr Website/                          ← git root
├── .gitignore                         ← added in Phase 0
├── Vokr-Implementation-Plan.md        ← this document
├── Vokr-Zero-Cost-...-Checklist.pdf   ← authoritative architecture (tracked)
├── vokr-backend-scope.docx            ← legacy scope, superseded (tracked)
├── vokr-production.zip                ← the 27-page legacy site (tracked; Phase 4 source)
├── vokr-production (1).zip            ← git-ignored: identical but one CSS hex value
├── index (7).html                     ← git-ignored: 19.9 MB base64 homepage variant
└── vokr/                              ← the deployable Next.js application
    ├── AGENTS.md  CLAUDE.md  README.md  .env.example
    ├── next.config.ts  tsconfig.json  eslint.config.mjs  postcss.config.mjs
    └── src/{app,components,config,lib,styles}
```

The git root is the workspace folder and the application is nested one
level down in `vokr/`. This is retained deliberately (ADR-016) — the
reference material legitimately lives beside the app, and flattening would
churn history for no functional gain. Every CI job and the Dockerfile set
their working directory to `vokr/`.

### 2.2 What is actually implemented

One commit exists: `5dc3b49` "Stage 1: production-ready application
foundation". It is a clean, honest foundation, and its message does not
overstate what it built.

| Area | State | Detail |
|---|---|---|
| Next.js | 16.3.4, App Router, Turbopack | Correct target per PDF §1 |
| React | 19.2.8 | |
| TypeScript | 5.x, `strict: true` | Path alias `@/*` → `./src/*` |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` | CSS-first `@theme inline`, light/dark tokens in `src/styles/globals.css` |
| Routes | `/` only | Plus `_not-found` |
| Route conventions | `layout` `page` `loading` `error` `global-error` `not-found` | All six present. `error.tsx` correctly uses the Next 16 `retry` prop — verified against `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`, not assumed |
| Server/client boundary | Correct | Only `error.tsx` and `global-error.tsx` carry `"use client"`, which the framework requires. Everything else is a Server Component. No client-boundary leakage. |
| Components | `ui/button`, `ui/container`, `layout/site-header`, `layout/site-footer` | Small, typed, dependency-free |
| Metadata | `src/lib/metadata.ts` + `src/config/site.ts` | Title template and `metadataBase` |
| Env | `.env.example` only | Documents the public/server split for Supabase, Razorpay, Brevo, Sentry and R2. **Nothing reads these variables except `NEXT_PUBLIC_SITE_URL`.** |
| Dependencies | 3 runtime, 8 dev | No unnecessary packages. `cn()` is three lines rather than pulling in `clsx` + `tailwind-merge` — right call at this size; revisit only if variant-heavy components arrive. |

### 2.3 What does not exist

Every one of these is absent, verified by inspecting the tree rather than
the README: product catalog, product pages, **any** API route, database,
Prisma, Supabase client, auth, guest sessions, cart, inventory, checkout,
Razorpay, orders, email, R2, Shiprocket, admin, search, analytics,
monitoring, **any test of any kind**, Dockerfile, CI workflow, deployment
configuration, `robots.txt`, `sitemap.xml`.

The application is four static pages. That is an accurate and acceptable
Stage 1 — the danger would be believing it is more.

### 2.4 Defects found in the Stage 1 foundation, and what was done

| # | Finding | Severity | Action |
|---|---|---|---|
| **F1** | `npm run typecheck` **failed on a clean checkout**: `error TS2304: Cannot find name 'LayoutProps'`. The App Router's route-aware global helpers are generated into the git-ignored `.next/types`, so `tsc --noEmit` alone cannot resolve them. The Stage 1 commit message claims "lint, typecheck, and production build all pass" — true only with a warm `.next/`. A CI job running `typecheck` on a fresh clone would have failed on day one. | **High** — would have broken CI in Phase 19 | **FIXED.** The script is now `next typegen && tsc --noEmit`, the pattern Next's own CLI reference prescribes. Re-verified after deleting `.next/`. |
| **F2** | **No `.gitignore` at the repository root.** 21.9 MB of loose reference binaries sat untracked beside the git root — one `git add -A` away from being in history permanently, including the 19.9 MB base64 homepage that R21 exists to eliminate. | **High** — irreversible once committed | **FIXED.** Root `.gitignore` added. The PDF, the backend scope and one canonical copy of the legacy site are now *deliberately tracked* so a fresh clone is self-sufficient; the 19.9 MB variant and the duplicate zip are excluded, with the reasoning written into the file. |
| **F3** | `next.config.ts` was empty — no `output: "standalone"`. | **High** — blocks R2 | **FIXED.** Artifact Registry's free tier is 0.5 GB and the PDF calls it "the tightest quota in the stack"; a conventional Next.js image is 150–400 MB, so three retained revisions breach it. Standalone output now produces a **29 MB** server bundle. `poweredByHeader: false` added alongside. |
| **F4** | `tsconfig.json` targeted `ES2017` and lacked `noUncheckedIndexedAccess`. | Medium | **FIXED.** Target raised to `ES2022`; `noUncheckedIndexedAccess: true` enabled. The latter makes every array and record access yield `T \| undefined` — the single highest-value strictness flag for code that will index cart lines and variant maps. Free to adopt across four files; painful to retrofit later. |
| **F5** | `src/types/index.ts` exported a `NavItem` interface used nowhere. | Low | **FIXED.** Deleted, along with the now-empty `types/` directory and its README entry. |
| **F6** | No skip link, and `<main>` had no `id` — keyboard users had no way past the header. | Low, but compounding | **FIXED.** Standard visually-hidden skip link added to the root layout. Cheap now; expensive once 27 migrated pages exist. |
| **F7** | `AGENTS.md` contained only the auto-generated Next.js block — no project rules at all, in a repository whose entire premise is phase-by-phase execution by agents. | Medium | **FIXED.** The non-negotiable money, payment, inventory, data and security rules now live there, pointing at this plan and the PDF. |
| **F8** | `tsconfig.json` carried `allowJs: true`. | Non-issue | **INVESTIGATED, NO CHANGE.** Removing it does not hold — `next typegen` re-adds it automatically on every run. It is also harmless here: the `include` globs are `**/*.ts`, `**/*.tsx`, `**/*.mts`, so no `.js` file ever enters the program regardless. **The `include` list, not `allowJs`, is what keeps untyped JavaScript out of this codebase. Do not widen it.** |

Two further items were considered and deliberately **not** changed:

- **Flattening `vokr/` to the repo root.** Structural churn, no functional
  benefit. See ADR-016.
- **Adding a test runner now.** There is nothing to test. It is the first
  task of Phase 1, where it binds to real code.

### 2.5 One latent production trap, deferred by design

`siteConfig.url` falls back to `http://localhost:3000` when
`NEXT_PUBLIC_SITE_URL` is unset, and `NEXT_PUBLIC_*` values are inlined at
**build** time. Because the production image is built inside GitHub
Actions, an unset variable there ships a container whose `metadataBase`,
canonical URLs and Open Graph image URLs all point at localhost — with no
runtime error anywhere.

This was **not** fixed by making the build throw, because that would break
`npm run build` on a fresh clone to guard against a failure that cannot
occur until CI exists. It is instead a hard gate in **Phase 19** and
appears in the §13 launch checklist. Do not lose it.

### 2.6 Git hygiene

| Check | Result |
|---|---|
| Branch | `master`, in sync with `origin/master` (0 ahead, 0 behind) |
| Remote | `origin` → github.com/SmaranReddy/Vokr-Website.git |
| History | 1 commit, clean message, no rewriting needed or performed |
| Tracked secrets | **None.** Tracked files scanned for `sk_live`, `rzp_live`, `rzp_test`, `service_role`, PEM blocks and JWT-shaped strings. The only hit is a `sha512-` integrity hash in `package-lock.json` — a false positive. |
| Tracked env files | Only `vokr/.env.example`. `vokr/.gitignore` correctly ignores `.env*` with a `!.env.example` exception. |
| Generated files | None tracked. `.next/`, `node_modules/`, `*.tsbuildinfo` and `next-env.d.ts` are all ignored. |

---

## 3. Target Production Architecture

Taken from PDF §1. Every row is a decision already made; §11 records why
each must not be casually changed.

### 3.1 The stack

| Layer | Component | Configuration |
|---|---|---|
| Frontend + API | Next.js App Router + TypeScript | **One deployable.** Pages and API routes in the same application. |
| Hosting | Google Cloud Run, `asia-south1` (Mumbai) | `min-instances=0`, `max-instances=3`, 1 vCPU, 512 MiB, concurrency 80, kept warm by Cloud Scheduler |
| Edge | Cloudflare Free | DNS, CDN, WAF, SSL, bot protection; aggressive cache rules on marketing pages and static assets |
| Database | Supabase PostgreSQL, Mumbai | Free tier (nano). Sole datastore: catalog, orders, inventory, carts, rate limits, ledger. |
| ORM | Prisma | Transaction-mode pooler with `pgbouncer=true` for normal queries; **direct/session connection for the checkout transaction** |
| Auth | Supabase Auth | Email + Google. Guest checkout supported. Application user data in Vokr's own Postgres. **Brevo custom SMTP is mandatory.** |
| Payments | Razorpay | Orders API, webhook signature verification, idempotency keys |
| Shipping / COD | Shiprocket | Manual panel at launch; API integration deferred until volume justifies the plan tier |
| Outbound email | Brevo | Transactional email *and* Supabase Auth custom SMTP. Single sending domain. |
| Inbound email | Zoho Mail Free | 5 mailboxes: `support@` `grievance@` `privacy@` `legal@` `careers@` |
| Object storage | Cloudflare R2 | Product images + database backups. Public bucket on a custom domain. |
| Search | Static JSON index served from the API | Single source of truth. No search engine, no Postgres FTS. |
| Cache | In-process catalog cache only | No Redis. 6-SKU catalog held in Cloud Run memory with a short TTL. |
| Jobs | Cloud Scheduler — exactly 3 | (1) keep-warm ping, (2) 6-hourly `pg_dump` to R2, (3) inventory reservation expiry + row pruning. No queue. |
| Monitoring | Sentry Developer + Cloud Logging | Weekly log export to R2 for DPDP retention |
| Backups | Self-managed `pg_dump` → R2 | Every 6 hours. Supabase Free has no backups and no PITR. |
| CI/CD | GitHub Actions → Artifact Registry → Cloud Run | Registry cleanup policy from the first commit |
| Secrets | Google Secret Manager | Exactly 6 active versions, loaded once at process boot |
| Domain | Cloudflare Registrar — `vokr.shop` | The only unavoidable fixed recurring cost |

### 3.2 Explicitly rejected at launch

Redis/Upstash · a separate queue or worker · Algolia or any search engine ·
Postgres full-text search · SMS / phone OTP · Clerk · Neon · Cloudflare
Pages as a separate deploy target · Google Cloud Storage for backups ·
Cloud Run `min-instances`.

Each was considered and rejected for a stated reason (§11). **Do not
reintroduce one without adding an ADR entry recording what measurement
changed the answer.**

### 3.3 The free-tier limits the architecture is shaped around

These are not trivia — several phases exist purely to respect them.

| Service | Allowance | Failure mode | Why it shapes the design |
|---|---|---|---|
| Supabase egress | 5 GB/mo uncached + 5 GB cached | **HTTP 402 across every Supabase service.** Storefront goes down mid-trading-day, no graceful degradation. *Sharpest risk in the stack.* | Drives "never `SELECT *`", the in-process catalog cache (R18), and images living in R2 |
| Supabase storage | 500 MB, **cumulative, never resets** | Writes fail | Drives scheduled pruning of abandoned carts and rate-limit rows; logs to Cloud Logging, never Postgres |
| Supabase backups | **None. No PITR.** | Total data loss on corruption | Drives the whole of Phase 18 |
| Supabase Auth built-in mailer | 2 emails/hour, **and only to your own project team** | **Silent.** `signUp()` succeeds, the email never arrives, no client error | R12 — the single most dangerous item in the programme |
| Supabase Auth rate limit | 30 sign-ins per 5 min **per IP** | HTTP 429 | Server-side Auth calls make every customer share Cloud Run's egress IP → an effective global cap of ~6 sign-ins/minute. Drives R13. |
| Brevo | **300 emails/day**, shared across transactional and marketing | Sending stops; order confirmations silently do not arrive | First bottleneck at ~70–75 orders/day |
| Artifact Registry | 0.5 GB | Billed silently | **Tightest quota in the stack.** Drives `output: "standalone"` and the keep-2-tags cleanup policy |
| Secret Manager | **6 active versions** | Billed | Exactly what Vokr needs — rotating a secret creates a seventh, so *disable* the old version rather than adding |
| Cloud Scheduler | 3 jobs **per billing account**, not per project | $0.10/job/mo | All 3 allocated. A staging project cannot have its own three. |
| Cloud Run egress | 1 GiB **North America only** — Mumbai gets zero | Billed $0.12/GiB | Drives Cloudflare cache rules and R2-hosted images |
| Cloudflare Free | 5 WAF custom rules | Upgrade to Pro | 5 is the practical ceiling for the Phase 16 rule set |
| Sentry | 5,000 errors/mo, 1 user | Events dropped | Error-rate bound, not volume bound — one crawler loop burns it in an afternoon |
| GitHub Actions | 2,000 min/mo private | **Hard stop** (default spending limit $0) | ~400 builds/month at 5 min |

### 3.4 Structural facts about "free"

1. A Google Cloud billing account with a valid payment method is
   **mandatory** to access Always Free at all.
2. **GCP Free Tier limits are a spending-based discount, not a spending
   ceiling.** They do not cap the bill. This is precisely why
   `max-instances` and billing budget alerts are launch blockers (R4)
   rather than nice-to-haves.

### 3.5 Production database schema plan

Postgres via Prisma. Principles first, because they decide the shape:

- **Money is stored as an integer number of paise** (`Int`, i.e. `₹9,995`
  → `999500`). Never float, never `Decimal` in application code. Int32
  tops out at ~₹21.4 million, far above any Vokr line item; aggregate
  ledger balances use `BigInt`.
- **Every identifier is stable and opaque.** UUID v7 (time-ordered, so
  index locality is preserved) for internal primary keys. **A product
  display name is never a key** — the legacy cart keyed on
  `"Model x (IN 9)"` and that is exactly the defect being removed.
- **Customer-facing identifiers are separate from primary keys.**
  `order_number` is `VK-#####` (matching the `VK-10234` format already in
  the legacy UI copy) generated from a Postgres sequence, unique, and never
  reused. It is what a guest types into order lookup; the UUID never leaks.
- **Never `SELECT *`.** Every Prisma query uses an explicit `select`.
  Enforced by review and by the Phase 13 egress budget test.
- **No images, no logs, no large text blobs in Postgres.**
- Timestamps are `timestamptz`, stored UTC, rendered in IST at the edge.

#### Entities

| Table | Purpose | Key columns | Constraints & indexes |
|---|---|---|---|
| `products` | One row per SKU family | `id` PK, `slug` unique, `name`, `description`, `category`, `hsn_code`, `gst_rate_bps`, `status`, `created_at` | `UNIQUE(slug)`. `gst_rate_bps` is basis points **per product**, resolved from D2 — never a global constant |
| `product_variants` | The sellable unit | `id` PK, `product_id` FK, `sku` unique, `size_label`, `colorway`, `price_paise`, `weight_grams`, `position`, `status` | `UNIQUE(sku)`, `UNIQUE(product_id, colorway, size_label)`, index on `(product_id, status)`. **This is the only entity a price may be resolved from.** |
| `inventory` | Stock per variant | `variant_id` PK/FK, `quantity_on_hand`, `quantity_reserved`, `updated_at` | **`CHECK (quantity_on_hand >= 0)`**, **`CHECK (quantity_reserved >= 0)`**, **`CHECK (quantity_on_hand - quantity_reserved >= 0)`**. One row per variant, created with the variant. The row that `SELECT … FOR UPDATE` locks. |
| `inventory_reservations` | Time-boxed holds during checkout | `id` PK, `variant_id` FK, `checkout_session_id` FK, `quantity`, `expires_at`, `state` (`held`/`committed`/`released`/`expired`) | Index on `(expires_at)` where `state = 'held'` for the expiry job; index on `checkout_session_id` |
| `app_users` | Application profile, 1:1 with a Supabase Auth user | `id` PK = Supabase `auth.users.id`, `email`, `display_name`, `phone_enc`, `created_at`, `deleted_at` | `UNIQUE(email)`. Living in Vokr's own Postgres is *why* Supabase Auth was chosen — `orders.user_id` is a real FK. Phone encrypted at rest. |
| `guest_sessions` | Anonymous identity before sign-in | `id` PK, `token_hash`, `created_at`, `last_seen_at`, `expires_at` | `UNIQUE(token_hash)` — the raw token lives only in an HttpOnly cookie; the DB stores a hash. Index on `expires_at` for pruning. |
| `carts` | One open cart per identity | `id` PK, `user_id` FK nullable, `guest_session_id` FK nullable, `status`, `created_at`, `updated_at` | `CHECK (user_id IS NOT NULL OR guest_session_id IS NOT NULL)`; partial `UNIQUE` on `user_id WHERE status='open'` and on `guest_session_id WHERE status='open'`. Index on `updated_at` for abandoned-cart pruning. |
| `cart_items` | Lines | `id` PK, `cart_id` FK, `variant_id` FK, `quantity`, `added_at` | `UNIQUE(cart_id, variant_id)`, `CHECK (quantity BETWEEN 1 AND 10)`. **Stores no price.** Price is resolved server-side on every read. |
| `addresses` | Shipping/billing | `id` PK, `user_id` FK nullable, `order_id` FK nullable, `name_enc`, `line1_enc`, `line2_enc`, `city`, `state`, `pincode`, `phone_enc`, `country` | Index on `pincode`. PII columns encrypted at rest. Order addresses are **snapshots** — editing a saved address must never mutate a placed order. |
| `checkout_sessions` | The bridge between cart and order | `id` PK, `cart_id` FK, `state`, `idempotency_key` unique, `pricing_snapshot` JSONB, `expires_at` | `UNIQUE(idempotency_key)`. Holds the server-computed price breakdown so the Razorpay amount and the order total provably agree. |
| `orders` | Placed orders | `id` PK, `order_number` unique, `user_id` FK nullable, `guest_email`, `status`, `subtotal_paise`, `shipping_paise`, `cod_fee_paise`, `discount_paise`, `tax_paise`, `total_paise`, `payment_method`, `payment_status`, `shipping_address_id` FK, `placed_at` | `UNIQUE(order_number)`. Index on `(user_id, placed_at DESC)`; index on `(lower(guest_email), order_number)` for guest lookup. `CHECK` that the totals reconcile. |
| `order_items` | Immutable line snapshot | `id` PK, `order_id` FK, `variant_id` FK, `quantity`, `unit_price_paise`, `line_tax_paise`, `gst_rate_bps`, `hsn_code`, `product_name_snapshot`, `variant_label_snapshot` | Denormalised on purpose: an order must render identically in three years even if the product is renamed, repriced or deleted. |
| `order_status_history` | Append-only state log | `id` PK, `order_id` FK, `from_status`, `to_status`, `actor`, `note`, `created_at` | Index on `(order_id, created_at)`. Powers the 4-step tracker the legacy UI already draws. |
| `payments` | Razorpay facts | `id` PK, `order_id` FK, `razorpay_order_id` unique, `razorpay_payment_id` unique nullable, `amount_paise`, `status`, `method`, `created_at` | `UNIQUE(razorpay_order_id)`, `UNIQUE(razorpay_payment_id)` — the uniqueness constraint *is* the duplicate-charge backstop |
| `webhook_events` | Every inbound webhook, verbatim | `id` PK, `provider`, `provider_event_id` unique, `event_type`, `signature_valid`, `payload` JSONB, `received_at`, `processed_at`, `processing_error` | **`UNIQUE(provider, provider_event_id)` is the idempotency mechanism.** Insert first, then process. Pruned after 90 days. |
| `rate_limit_counters` | Postgres-backed limiting | `key` PK, `window_start`, `count` | Index on `window_start` for the pruning job. **Cumulative growth — pruning is mandatory, not optional.** |
| `consent_records` | DPDP | `id` PK, `subject_id`, `subject_type`, `purpose`, `granted`, `policy_version`, `source`, `ip_hash`, `created_at` | Append-only. Never updated — a withdrawal is a *new row*, so the history is provable. |
| `data_subject_requests` | DPDP export/erasure | `id` PK, `subject_id`, `type`, `state`, `requested_at`, `completed_at`, `artifact_url` | Index on `state` |
| `audit_log` | Who changed what | `id` PK, `actor_type`, `actor_id`, `entity_type`, `entity_id`, `action`, `before` JSONB, `after` JSONB, `created_at` | Index on `(entity_type, entity_id, created_at)`. Orders and payments only at launch. |
| `store_credit_ledger` | Append-only, double-entry | `id` PK, `user_id` FK, `entry_type`, `amount_paise`, `balance_after_paise`, `reference_type`, `reference_id`, `created_at` | **Not built at launch.** D1 (8 Sep 2026) deferred gift cards, which were this table's only launch-relevant trigger. Build only when COD refunds to store credit or referrals go live. Never a mutable balance column. |

#### Transaction boundaries

Only one transaction in the system is genuinely dangerous, and it is
specified in Phase 8:

```
BEGIN                                    -- direct/session connection, not the pooler
  SELECT quantity_on_hand, quantity_reserved
    FROM inventory
   WHERE variant_id = ANY($1)
   ORDER BY variant_id                   -- deterministic order ⇒ no deadlock
     FOR UPDATE;
  -- validate availability for every line
  UPDATE inventory SET quantity_reserved = quantity_reserved + …;
  INSERT INTO inventory_reservations (…, expires_at = now() + 15 min);
  UPDATE checkout_sessions SET state = 'reserved';
COMMIT
-- ↓ Razorpay order creation happens HERE, outside the lock (R9)
```

`ORDER BY variant_id` is not decoration: without a deterministic lock
order, two carts containing the same two variants in opposite order will
deadlock under concurrency, and Phase 21 will find it.

#### Retention and deletion

| Data | Retention | Mechanism |
|---|---|---|
| Abandoned carts | 30 days after `updated_at` | Cloud Scheduler job 3 |
| Expired reservations | Released at `expires_at`; rows pruned at 7 days | Cloud Scheduler job 3 |
| Rate-limit counters | 24 hours | Cloud Scheduler job 3 |
| Webhook events | 90 days | Cloud Scheduler job 3 |
| Guest sessions | 90 days after `last_seen_at` | Cloud Scheduler job 3 |
| Orders, payments, invoices | **8 years** (Indian tax retention) | Never auto-deleted. Erasure requests anonymise PII in place and retain the financial record. |
| Consent records | Life of the account + 1 year | Append-only |
| Processing / traffic logs | **1 year minimum** (DPDP Rules) | Cloud Logging default retention is 30 days → weekly export to R2 |

### 3.6 Catalog plan — the real five SKUs at launch

Derived by inspecting the legacy pages directly, and corroborated by
`vokr-backend-scope.docx` §3, which names 6 shop pages: *"Serves the 6 shop
pages already built (Model x, Model 001, Kids, Socks, Laces, Gift Cards)"*.
**Decision D1 (8 Sep 2026) deferred the sixth — gift cards — from launch.**
The launch catalog is five SKUs. The gift-card page is not migrated, not
linked, and not reachable anywhere on the site (see Phase 4); no
gift-card purchasing, redemption or ledger functionality is built.

| # | Product | Proposed slug | Legacy `data-name` | PDP `<h1>` | Price | Variant axis |
|---|---|---|---|---|---|---|
| 1 | Model x | `model-x` | `Model x` | Model x | ₹9,995 | IN 4–11 (8 sizes) × colorway |
| 2 | Model 001 | `model-001` | `Model 001` | Model 001 | ₹8,995 | IN 4–11 (8 sizes) |
| 3 | Kids Model 123 | `kids-model-123` | `Kids Model 123` | Kids Model 123 | ₹5,995 | IN 10, 11, 12, 13, 1, 2, 3 (7 sizes) |
| 4 | Vokr Socks | `socks` | `Socks (3-pack)` | Vokr Socks | ₹495 | S/M, M/L, L/XL (3) |
| 5 | Stretch Laces | `stretch-laces` | `Stretch Laces` | Stretch Laces | ₹295 | One Size (1) |

~~Gift Card (`gift-card`, ₹1,000/2,000/5,000/10,000, 4 denominations)~~ —
**deferred, D1.** Not seeded, not displayed. Do not add it to the seed or
the catalog service. Revisit only per the trigger in §10A.

**SKU format.** `VK-<PRODUCT>-<COLORWAY>-<SIZE>`, e.g.
`VK-MX-WHTBLK-IN09`. Uppercase, no spaces, unique across the catalog,
stable forever. Sizes are zero-padded so they sort lexically. The SKU is
the human-readable key; the UUID is the machine key; **neither is a
display name.**

**Discrepancies found, and their resolutions:**

| Discrepancy | Evidence | Resolution |
|---|---|---|
| Socks are named three different things | `<h1>` says "Vokr Socks", the cart button says "Socks (3-pack)", the search index says "Socks" | Canonical product name **"Vokr Socks"**; "3-pack" belongs in the description, not the name. Exactly the drift that display-name keys cause. |
| **Two phantom products in the search index** | 4 of 27 pages carry a 15-entry index; the other 23 carry 13. The extras are **"Model 251 Low" (₹9,495)** and **"Masks"** — *neither has a page*. | Both are excluded from the catalog. Do not seed them. The PDF names only Model 251 Low; **"Masks" is a second phantom found in this audit and is recorded here as a new finding.** |
| `Model x — White & Black` appears as its own search entry but has no page | Legacy `index.html` markets it as a colorway: *"White & Black. Available now in limited quantities."* | It is a **colorway of Model x**, not a product. This is why `product_variants` carries a `colorway` axis rather than size alone. Confirm the full colorway list against real inventory before seeding. |
| Gift card price is a live defect | `gift-cards.html` offers ₹1000/2000/5000/10000 but the button is hardcoded `data-price="2000"` — choosing ₹10,000 adds ₹2,000 | Moot at launch: **D1 (8 Sep 2026)** deferred the gift-card SKU entirely, so the page and its defect are not migrated. Server-side price resolution (Phase 2 + Phase 5) still eliminates this entire *class* of defect for the five SKUs that do launch. |
| Kids Model 123 vs DPDP | PDF §9 defers it "until parental consent built" but adds that selling as an adult-purchased gift with no child account is fine | **Sellable at launch**, provided no child account, no child profile and no child data are collected. Enforced in Phase 17. |
| Backend scope says "at two SKUs" in §1 and "6 shop pages" in §3 | Internal inconsistency in a superseded document | **Six.** §3 enumerates them; §1's "two" is stale. |

**Seeding.** The seed is deterministic and idempotent: fixed UUIDs, upsert
by `sku`, safe to re-run against any environment. Prices come only from
this table. GST rates come only from D2 — the seed leaves `gst_rate_bps`
`NULL` and a `CHECK` refuses to sell a variant whose product has no rate,
so an unanswered D2 fails loudly at seed time instead of silently
mis-charging tax.

---

## 4. Current Gaps

The distance from §2 to §3, grouped by the phase that closes it.

### 4.1 Legacy defects that must be eliminated, never migrated

The 27 static pages are **reference material, not a starting point.** Each
of these is confirmed present in `vokr-production.zip` by direct inspection:

| Legacy defect | Measured | Killed by |
|---|---|---|
| 27 standalone HTML pages, ~80 KB of CSS/JS duplicated across every one | 27 files, 81–110 KB each | Phase 4 |
| Duplicated, **drifted** search index | 13 entries in 23 files, 15 in 4 files; extras are two products that do not exist | Phase 13 |
| Dead forms | **67** occurrences of `onsubmit="return false;"`; **zero** `fetch()` or `XMLHttpRequest` in the entire codebase | Phases 3–11 (PDF says 62 forms; this audit counts 67 across the canonical zip — same finding, the count is not load-bearing) |
| Mocked in-memory cart | IIFE-scoped JS array, resets on navigation, keyed by display-name concatenation (`"Model x (IN 9)"`) | Phase 5 |
| Client-controlled pricing | `data-price` DOM attributes; gift-card button hardcoded to `2000` regardless of selection | Phase 2 + Phase 5 |
| Cosmetic authentication | No password field anywhere; any string flips the panel to "signed in"; the Google button is a hardcoded `signIn('you@vokr.shop')` | Phase 3 |
| Nonexistent inventory | Zero stock concept; sizes 4–11 always render, never sold out | Phase 8 |
| Fabricated reviews and ratings | 10 hardcoded review objects with `verified: true`, a "4.7" average, and a meta description claiming **"4,059 customer reviews"** | Phase 4 (**R20** — Consumer Protection Act exposure before it is an engineering problem) |
| Third-party image dependency | **84** references to `cdn.shopify.com` across 8 files | Phase 14 |
| Oversized base64 payloads | `index (7).html` inlines 10 base64 images (6 PNG, 4 JPEG) producing a **19.9 MB** page | Phase 14 (**R21**, target <500 KB) |
| No tooling | No git, no `package.json`, no build, no CI, no `robots.txt`, no sitemap, no analytics | Phase 0 (done) + Phases 4, 19 |

### 4.2 Missing infrastructure

Nothing in §3 exists yet beyond the application shell. Every provider
account, every credential, every deployment artefact is still to be
created. The provider-account work has long lead times (Razorpay KYC,
Shiprocket, Zoho DNS verification, Cloudflare nameserver delegation) and
is therefore pulled forward: **start D3 today**, not in Phase 7.

### 4.3 Missing engineering practice

- **No tests of any kind.** No runner, no fixtures, no CI gate. Closed in
  Phase 1 and enforced from then on by §12.
- **No runtime environment validation.** `.env.example` documents a
  contract nothing checks. Closed in Phase 1.
- **No error reporting.** `error.tsx` logs to `console` in development and
  swallows in production. Closed in Phase 15.
- **No structured logging, no request IDs, no health endpoint.** Closed in
  Phase 15.

---

## 5. Master Phase Roadmap

Every phase uses the same 18 headings. A phase is complete only when its
**Exit Criteria** are met *and* the §12 Definition of Done is satisfied —
compiling is not completion.

Phase boundaries follow the PDF's recommended build order (§12 of the PDF),
expanded so that each unit is independently reviewable and testable.

---

### PHASE 0 — Current-State Audit + Foundation Corrections

#### Status
**COMPLETE** — 7 September 2026

#### Objective
Establish ground truth about what exists, correct anything in the Stage 1
foundation that is below production quality or conflicts with the target
architecture, and produce this plan.

#### Why It Exists
Everything downstream is planned against the *actual* repository. An
implementation plan built on assumptions about a scaffold nobody read is
worse than no plan. The correction pass exists because foundation defects
compound: F1 alone would have surfaced as a mysterious CI failure fifteen
phases later.

#### Prerequisites
None.

#### Scope
Full audit of the working tree, git history, configuration and dependencies;
extraction and reading of the PDF, both legacy zips, the backend scope
document and the 19.9 MB homepage variant; correction of foundation defects
F1–F7; creation of `Vokr-Implementation-Plan.md` and the `AGENTS.md` rules.

#### Explicitly Out of Scope
Any Phase 1+ feature work. No database, no dependencies added, no
integrations, no test runner.

#### Implementation Tasks
1. ✅ Inspect `git status`, `branch`, `log`, `remote`; confirm no history rewrite is needed.
2. ✅ Read every tracked file in `vokr/`.
3. ✅ Extract and read the PDF in full (10 pages).
4. ✅ Extract both zips, diff them, confirm one canonical copy.
5. ✅ Verify each PDF legacy finding against the code (84 Shopify refs, 67 dead forms, 0 `fetch()`, 13-vs-15 index drift, gift-card price defect, fabricated reviews).
6. ✅ Extract `vokr-backend-scope.docx`; identify conflicts with the PDF.
7. ✅ Verify the Next 16 error-boundary API against `node_modules/next/dist/docs/`, not memory.
8. ✅ Run `lint`, `typecheck`, `build`; find and fix F1.
9. ✅ Apply corrections F2–F7; re-validate from a clean `.next/`.
10. ✅ Write this plan and the `AGENTS.md` rules.
11. ✅ Single clean commit; no force-push, no history rewrite.

#### Files / Areas Affected
`.gitignore` (new) · `Vokr-Implementation-Plan.md` (new) · `vokr/package.json` · `vokr/next.config.ts` · `vokr/tsconfig.json` · `vokr/AGENTS.md` · `vokr/README.md` · `vokr/src/app/layout.tsx` · `vokr/src/types/index.ts` (deleted)

#### Database Impact
None.

#### API Impact
None.

#### UI Impact
Skip link added to the root layout.

#### Security Requirements
Confirm no secrets are tracked; confirm `.env*` is ignored everywhere;
prevent 21.9 MB of untracked binaries from entering history.

#### Testing Requirements
None (no test infrastructure yet — that is Phase 1). Validation is by
toolchain.

#### Validation
`rm -rf .next && npm run lint && npm run typecheck && npm run build` from a
clean checkout. `.next/standalone` inspected for size.

#### Acceptance Criteria
- All three toolchain commands pass with no `.next/` present. ✅
- Standalone output produced. ✅ (29 MB)
- No secret or generated file tracked. ✅
- Plan document exists and covers §1–§13. ✅

#### Production Checklist Mapping
Partial groundwork for **R1** (git repository) and **R2** (registry size
discipline, via `output: "standalone"`).

#### Dependencies
None.

#### Exit Criteria
Plan committed; corrections validated; no later-phase feature work started.

---

### PHASE 1 — Foundation Stabilization

#### Status
**COMPLETE** — 7 September 2026

#### Objective
Give the repository the engineering practice every later phase depends on:
a test runner with a real CI gate, boot-time environment validation, a
formatter, and the local Postgres path used for database work.

#### Why It Exists
Phases 5–9 handle money. Writing them before a test harness exists means
writing them without a way to prove they are right. This phase is small,
and skipping it makes every subsequent phase's Definition of Done
unachievable.

#### Prerequisites
Phase 0.

#### Scope
Vitest + a Node test environment; Playwright scaffolding (no e2e tests
yet); a typed, validated environment module; Prettier; Docker Compose
Postgres for local development; npm scripts wired to one `verify` command.

#### Explicitly Out of Scope
Any Prisma schema (Phase 2). Any CI workflow file (Phase 19 — the runner
must exist first, but the pipeline that runs it is a deployment concern).
Sentry (Phase 15).

#### Implementation Tasks
1. ✅ Add `vitest` + `@vitejs/plugin-react` + `@testing-library/react` + `jsdom`. Create `vitest.config.mts` (`.mts`, not `.ts` — Vite's native config loader otherwise warns on ESM-in-CJS and on `__dirname`) with two projects: `node` (default, for `src/lib/**` and `src/server/**`) and `jsdom` (for components).
2. ✅ Add `npm run test`, `test:watch`, `test:coverage`. Coverage thresholds start at 0 in `vitest.config.mts`, to be ratcheted per phase.
3. ✅ Add `npm run verify` = `lint && typecheck && test && build`. **This is the single command the DoD refers to.**
4. ✅ Create `src/lib/env.ts`: a `zod` schema splitting `client` (`NEXT_PUBLIC_*`) from `server` variables, parsed **once at module load**, exporting a frozen typed object. Throws a single readable aggregated error listing every invalid/missing variable via the exported `parseEnvSection()` helper — never fails one at a time. `assertNoServerKeyLeak()` runs at import time and would throw if any server-only name were ever declared under a `NEXT_PUBLIC_` alias.
5. ✅ Wired `siteConfig` to read from `clientEnv`, not `process.env` directly. Kept the localhost fallback, now marked `// PHASE 19 GATE` referencing §2.5. (The URL default itself lives in `site.ts`, not `env.ts`, so `NEXT_PUBLIC_SITE_URL` stays genuinely optional at the schema level — see the Deferred Items note below.)
6. ✅ Added `prettier` + `eslint-config-prettier` (wired into `eslint.config.mjs`); `npm run format` and `format:check`. The 4 files the existing tree needed reformatting — `AGENTS.md`, `README.md`, `src/app/not-found.tsx`, `src/components/layout/site-header.tsx` — landed in one isolated commit (`ffb8eb9`) before any Phase 1 feature commit.
7. ✅ Added `docker-compose.yml` with `postgres:17-alpine`, a named volume and a health check. **Verified live**, not just written: `docker compose up -d` → container reached `healthy`, `pg_isready` and a real `psql -c "SELECT version()"` both succeeded (PostgreSQL 17.10), then `docker compose down`.
8. ✅ Added `.nvmrc` pinning Node. Also bumped `engines.node` from `>=20.9.0` to `>=22.12.0` and `@types/node` from `^20` to `^22` — **a correction beyond the original task wording**: Node 20 "Iron" LTS reached end-of-life before this phase started (April 2026), and `vitest@5` hard-requires `@types/node` `^22 || >=24` as a peer dependency, so `npm install` failed with an unresolvable ERESOLVE conflict under the old pin. Node 22 "Jod" is the current LTS.
9. ✅ Wrote the first tests: `cn()` (3 tests), `createMetadata()` (2 tests), `env.ts` failure modes — missing var, wrong type, `NEXT_PUBLIC_` leak of a server name, plus 2 success-path tests (6 tests) — and `toErrorResponse()` (7 tests, one per error class plus unrecognised-error and unique-requestId cases). **17 tests total**, all passing.
10. ✅ Added `src/lib/errors.ts`: `AppError` base plus `ValidationError` (400), `NotFoundError` (404), `ConflictError` (409), `RateLimitError` (429), `InternalError` (500), and `toErrorResponse()`. An unrecognised thrown value always maps to a generic 500 with no internal message leaked, in every environment — verified by a dedicated test.
11. ✅ Added Playwright scaffolding (`@playwright/test` + `playwright.config.ts`, `testDir: "./e2e"`) per the phase's **Scope** statement, which named it explicitly even though the numbered task list originally omitted it. No `e2e/` specs yet — first ones land in Phase 4 per §7.1.

#### Files / Areas Affected
`vokr/package.json` · `vokr/package-lock.json` · `vokr/vitest.config.mts` · `vokr/playwright.config.ts` · `vokr/.prettierrc` · `vokr/.prettierignore` · `vokr/.nvmrc` · `vokr/docker-compose.yml` · `vokr/eslint.config.mjs` · `vokr/src/lib/env.ts` · `vokr/src/lib/errors.ts` · `vokr/src/config/site.ts` · `vokr/src/lib/__tests__/` · `vokr/.env.example` · `vokr/AGENTS.md` (formatting only) · `vokr/README.md` (formatting only) · `vokr/src/app/not-found.tsx` (formatting only) · `vokr/src/components/layout/site-header.tsx` (formatting only)

#### Deferred Items
- **Coverage thresholds start at 0**, exactly as the phase specifies ("begin at 0 and raise it per phase"). Not a shortfall — this is the stated design.
- **`npm run verify` does not run `format:check`.** Prettier formatting is enforced by convention (`npm run format` before committing) and CI can add a `format:check` gate in Phase 19 alongside the workflow file itself; adding it to `verify` now would make an un-actioned local formatting drift block `test`/`build` for no safety benefit at this stage. Recorded here so Phase 19 doesn't silently drop it.
- **Playwright has no real specs.** Scaffolding only, as the phase's own Scope line specifies ("no e2e tests yet").

#### Database Impact
None in the application. A local Postgres container becomes available.

#### API Impact
None yet. `toErrorResponse()` establishes the contract every future route
uses: a stable machine-readable `code`, a safe human `message`, and a
`requestId`. **Internal error text and stack traces never cross the
boundary.**

#### UI Impact
None.

#### Security Requirements
- `env.ts` must **fail the process at boot** on a missing server secret, not
  at first use in a checkout.
- A test asserts that no server-only variable name is ever read through a
  `NEXT_PUBLIC_` prefix.
- `toErrorResponse()` must never leak an internal message in production.

#### Testing Requirements
Unit tests for `cn`, `createMetadata`, `env` (3 failure modes), and
`toErrorResponse` (each error type → correct status and shape). This is the
phase that establishes tests exist at all; **mandatory before Phase 2.**

#### Validation
`npm run verify` run green from a clean `.next/`. `next dev` boots and
`GET /` returns 200. Deliberately set `NEXT_PUBLIC_SITE_URL=not-a-valid-url`
and confirm `src/lib/env.ts` throws one aggregated, readable error before
serving any request (reproduced directly via
`npx tsx -e "require('./src/lib/env.ts')"`, not just reasoned about).
`grep`'d `.next/static` for every server-only secret name — zero matches.
`docker compose up -d` brought Postgres to `healthy`, `psql` connected and
ran `SELECT version()` (PostgreSQL 17.10), then `docker compose down`.

#### Acceptance Criteria
- ✅ `npm run verify` runs lint, typecheck, tests and build in one command — verified green from a clean `.next/`.
- ✅ ≥ 8 passing tests — 17/17 passing across 4 test files.
- ✅ Local Postgres reachable via Compose — verified live (`healthy` status, real `psql` query), not just configured.
- ✅ An invalid env var produces a single aggregated, readable error at import time, verified by direct reproduction. (No variable is currently *required* — see the note on task 4/5: nothing in this codebase reads a Supabase/Razorpay/Brevo/R2 variable yet, matching the README's existing "reserved contract, not live integrations" statement. `parseEnvSection()`'s missing-variable aggregation is unit-tested directly with a synthetic required schema rather than a real one, since fabricating a "required" flag on an unused Phase 2+ variable would be scope creep into integrations this phase explicitly excludes.)

#### Production Checklist Mapping
Enables **R5** (environment separation) and the testing half of **R6–R10**.

#### Dependencies
None external.

#### Exit Criteria
`npm run verify` is the one command that gates every future commit, and it
passes. **Met.**

---

### PHASE 2 — Catalog + Database

#### Status
**COMPLETE** — 8 September 2026, with one non-blocking manual step still
open (see below).

Everything in this phase's scope is implemented and verified against a
real Postgres — schema, migrations (including the hand-written CHECK
constraints, the GST-enforcement trigger and RLS), the idempotent seed,
the catalog service with its cache, both API routes, and the full test
suite (unit + integration). What is **not** done is task 1, "create the
Supabase project in `ap-south-1`" — that requires a human with a cloud
account and cannot be performed by this agent. Everything was instead
built and verified against the `docker-compose.yml` Postgres, exactly as
`.env.example` already anticipated ("For local development against
`docker-compose.yml`'s Postgres, before Supabase is wired up..."). Moving
to the real Supabase project later is a `DATABASE_URL`/`DIRECT_URL` swap
in `.env.local` (Supabase's pooled/direct connection strings), not new
engineering work — `prisma migrate deploy` and `prisma db seed` run
unchanged against it. This is recorded as a remaining blocker below and
should be picked up alongside D3 (also a human/account-creation
prerequisite with long lead time).

#### Objective
Stand up Supabase Postgres, Prisma, the launch schema, and a deterministic
seed of the real five launch SKUs with server-authoritative prices.

#### Why It Exists
Everything else reads product data. It is also where the client-controlled
pricing defect dies structurally: after this phase there is exactly one
place a price can come from.

#### Prerequisites
Phase 1 (met). **D1 resolved** (8 Sep 2026: gift cards deferred — launch
catalog is five SKUs). **D2 does not gate this phase** —
`gst_rate_bps` is stored nullable per product with a trigger that
refuses an active variant with no rate, so the schema and seed are built
now and D2 can be supplied later without a migration.

A Supabase project in Mumbai is **not** a prerequisite for the engineering
work — it turned out to be a deployment-target detail, not a blocker for
writing and testing the schema. `docker-compose.yml`'s Postgres (already
provisioned in Phase 1 for exactly this) stood in for it. Creating the
real project remains an open, human-only task — see Status above.

#### Scope
Supabase project; Prisma with dual connection strings; the schema from
§3.5 for catalog, inventory and their constraints; migrations; the
idempotent seed; a read-only catalog service with the in-process cache
(R18); the first API routes.

#### Explicitly Out of Scope
Carts, orders, payments, users — those tables land in the phases that use
them. Admin CRUD (Phase 12). Images (Phase 14). Search (Phase 13).

#### Implementation Tasks
1. ⬜ Create the Supabase project in `ap-south-1` (Mumbai). **Not done — requires a human with a cloud account.** Built and verified against `docker-compose.yml` Postgres instead (see Status).
2. ✅ Added `prisma` + `@prisma/client` (7.10.0, pinned — `latest` was an `8.0.0-rc` at install time). Configured `DATABASE_URL` and `DIRECT_URL`; Prisma 7 dropped the schema-level `directUrl` field (confirmed against installed `@prisma/config` types), so the pooled/direct split for the Phase 8 checkout transaction is now an application-level concern (a second driver-adapter instance from `DIRECT_URL`), not a config-file setting — `DIRECT_URL` instead feeds `shadowDatabaseUrl` for `migrate dev`, conditionally (only when it actually differs from `DATABASE_URL`, or Prisma errors on an identical shadow/main pair — which is what local dev has today).
3. ✅ `prisma/schema.prisma` written for `products`, `product_variants`, `inventory`. Money as `Int` paise. IDs via Prisma's client-side `@default(uuid(7))`.
4. ✅ The three `inventory` `CHECK`s and `UNIQUE(sku)` are in the first migration (`prisma/migrations/20260908055107_init_catalog/`). Prisma's schema language has no CHECK primitive, so they're hand-added SQL in the generated migration file, verified against the real schema (`\d inventory` confirms all three).
5. ✅ Implemented as a **database trigger** (`enforce_variant_gst_rate`, BEFORE INSERT OR UPDATE on `product_variants`), not a plain CHECK — a bare CHECK cannot reference the parent product's `gst_rate_bps` across tables. Verified live: activating a variant on a product with `gst_rate_bps IS NULL` raises `product_variants: cannot set variant ... to active — its product (...) has no gst_rate_bps yet`; setting a rate and retrying succeeds.
6. ✅ `src/server/db/client.ts` — singleton guarded via `globalThis`, `PrismaPg` driver adapter (required for SQL providers in Prisma 7), query logging (`query`/`warn`/`error`) in development only, `error`-only in production.
7. ✅ `prisma/seed.ts` (thin CLI entrypoint) + `prisma/seed-data.ts` (the actual five-SKU data and upsert logic, shared with the integration test so both exercise the same code). Fixed UUIDv7s, upsert by `sku`/`slug`. Re-seeding verified idempotent (5 products / 27 variants / 27 inventory rows, twice). No gift-card SKU (D1). **Deviation from the task text:** products seed as `status: "active"` (a product *family* is real and browsable), variants seed as `status: "draft"` (the GST trigger would reject `"active"` anyway while D2 is open) — see the catalog-service note under task 8.
8. ✅ `src/server/catalog/service.ts` — `listProducts()`, `getProductBySlug()`, `getVariantById()`, `resolvePrices()`, all through one explicitly-`select`ed query. **Extended beyond the literal task list:** each variant carries an `isPurchasable` flag (`status === "active"`); `getVariantById()` and `resolvePrices()` treat a not-yet-purchasable variant identically to a nonexistent one (both throw `NotFoundError`) so a variant gated on D2 can never leak a price. This is why the "known variant ID" unit test in Testing Requirements uses a fixture, not the real (currently all-`draft`) seed — see Testing Requirements below.
9. ✅ `src/server/catalog/cache.ts` — `TtlCache`, a keyed `Map` (not a single value, so it can serve more than one entry if a later phase needs it) with a 60s TTL and a single-flight guard (concurrent misses collapse into one in-flight fetch). ~50 lines with comments, under 30 without.
10. ✅ `GET /api/catalog/products` and `GET /api/catalog/products/[slug]`. Manually exercised against a running `next dev` — see Validation.
11. ✅ `src/server/catalog/__tests__/no-select-star.test.ts` — scans every non-test `.ts` file under `src/server/` for `prisma.*.(findMany|findFirst|...)` calls and fails if any lacks `select:` or uses `include:`. A static-source scan, not full AST analysis — proportionate to the ask, not a general-purpose linter.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/prisma/migrations/20260908055107_init_catalog/migration.sql` · `vokr/prisma/seed.ts` · `vokr/prisma/seed-data.ts` · `vokr/prisma/__tests__/catalog.integration.test.ts` · `vokr/prisma7.config.ts` · `vokr/src/server/db/client.ts` · `vokr/src/server/catalog/*` · `vokr/src/app/api/catalog/**` · `vokr/vitest.config.mts` · `vokr/vitest.integration.setup.ts` · `vokr/docker-compose.yml` (port 5432 → 55432 — see below) · `vokr/.env.example` · `vokr/.env.local` (git-ignored) · `vokr/.gitignore` · `vokr/package.json` · `vokr/README.md` · `vokr/AGENTS.md`

**Unplanned fix, discovered during this phase:** `docker-compose.yml` mapped Postgres to host port 5432, which silently collided with a native Postgres service already running on this machine (`postgres.exe`) — connections routed to the wrong server and failed authentication with a confusing error. Remapped to `55432`. Documented in the compose file, `.env.example`, and README so the next person doesn't lose time to it.

#### Database Impact
First migration. Creates `products`, `product_variants`, `inventory` with
their constraints, indexes, the GST-enforcement trigger, and RLS enabled
on all three tables (no policies yet — see Security Requirements).

#### API Impact
Two read-only routes, confirmed live: `GET /api/catalog/products` (200,
all 5 products/27 variants) and `GET /api/catalog/products/[slug]` (200
for a real slug, 404 with the typed `NotFoundError` contract for an
unknown one). No mutations. No authentication yet — the catalog is
public.

#### UI Impact
None (Phase 4 consumes these).

#### Security Requirements
- `SUPABASE_SERVICE_ROLE_KEY` and both connection strings are **server-only**. Verified by hand this phase (`grep` of `.next/static` for `DATABASE_URL`, `DIRECT_URL`, `vokr_local_dev` after a production build returns zero matches) — same manual-repeat-per-phase practice Phase 1 established, not yet a standing automated test. Good Phase 19 CI candidate.
- Row Level Security enabled on every table from the first migration. Verified live via `pg_class.relrowsecurity` (integration test) and confirmed the connecting local-dev role still reads/writes normally (it owns the tables, so it bypasses RLS by default — exactly the intended launch-day shape).
- No `SELECT *` anywhere — enforced by `no-select-star.test.ts` (task 11).

#### Testing Requirements
- ✅ Unit: price resolution returns the seeded price for a known, purchasable variant and throws `NotFoundError` for both an unknown variant and a known-but-not-yet-purchasable one (`service.test.ts`, fixture-based — decoupled from the real seed's current state, since every real seeded variant is legitimately `draft` until D2 is answered).
- ✅ Unit: cache returns a cached value inside the TTL, refetches after it, and single-flights concurrent misses into one call (`cache.test.ts`, 6 tests including a rejection-is-not-cached case beyond the literal ask).
- ✅ Integration (Compose Postgres): migrate + seed + re-seed idempotent, row counts identical (5/27/27, asserted twice).
- ✅ Integration: all three `inventory` CHECK constraints reject negative/inconsistent values.
- ✅ Integration: duplicate `sku` insert fails.
- ✅ Regression: no query omits `select` (static scan, see task 11).
- **Added beyond the literal list:** an integration test for the GST-enforcement trigger itself (rejects activation with no rate, allows it once a rate is set, restores the D2-unresolved state afterward) and for RLS being enabled on all three tables.

#### Validation
Seeded twice; row counts identical (5/27/27) both times. Booted `next dev`
and queried both live routes with `curl` — response JSON carries exactly
the selected fields, `isPurchasable: false` on every variant (expected:
D2 is unresolved), and no `gift-card` slug anywhere in the catalog.

#### Acceptance Criteria
- ✅ Five products (D1: no gift card), their variants (27) and one `inventory` row per variant (27) exist.
- ✅ Prices come **only** from `product_variants.price_paise` — confirmed structurally (no other column/table stores a price) and behaviourally (`resolvePrices()` is `catalog`'s only price-shaped export).
- ✅ `resolvePrices()` is the only exported path to a price from `src/server/catalog`.
- ✅ Attempting to store a negative quantity fails at the database (three separate CHECK constraints, each independently verified).

#### Production Checklist Mapping
**R6** (server-side price resolution — structural half: IMPLEMENTED, not
yet VERIFIED at the launch-gate level — that needs Phase 5's behavioural
half too), **R18** (catalog cache: IMPLEMENTED).

#### Dependencies
D1 (resolved). D2 not required — see Prerequisites. Supabase account:
**still open**, tracked as a remaining blocker (see Status).

#### Exit Criteria
✅ A price cannot be obtained anywhere in the codebase except by passing a
variant ID to the server — verified: the only `price_paise` reads in
`src/server/` are inside `catalog/service.ts`, and it is the sole module
exporting anything price-shaped.

---

### PHASE 3 — Authentication + Guest Sessions

#### Status
**NOT STARTED**

#### Objective
Real authentication via Supabase Auth (email/password + Google), real guest
sessions, and **Brevo configured as Supabase Auth's custom SMTP provider,
verified by a delivered email.**

#### Why It Exists
The legacy site's sign-in is cosmetic — any string signs you in. More
importantly this phase closes **R12**, the only defect in the entire stack
that fails *silently* at zero traffic on the very first real customer:
Supabase's built-in mailer sends 2 emails/hour and **only to addresses on
your own project team**. `signUp()` returns success; the customer receives
nothing; there is no client-side error.

#### Prerequisites
Phase 2. Brevo account with a verified sending domain and SPF/DKIM/DMARC
published on `vokr.shop`.

#### Scope
Supabase Auth wiring; `app_users` and `guest_sessions` tables; session
handling via HttpOnly cookies; server-side user access helpers; guest →
authenticated transition; password reset; Brevo SMTP; auth rate limiting;
client-IP forwarding.

#### Explicitly Out of Scope
Cart merge *behaviour* (Phase 5 — this phase only establishes the identity
transition). Saved addresses (Phase 6). Order history (Phase 9). SMS/phone
OTP (**deferred**, §10).

#### Implementation Tasks
1. Enable email/password and Google providers in Supabase. Configure the OAuth consent screen and redirect URLs for dev, staging and production.
2. **Configure Brevo as custom SMTP in Supabase Auth before creating any real account.** Then raise the email rate limit from its 30/hour default (R13).
3. Send a real signup confirmation to an address **outside** the project team and confirm delivery. Until that email lands in an external inbox, R12 is not done.
4. Add `app_users` and `guest_sessions` migrations. `app_users.id` = the Supabase `auth.users.id`.
5. Build `src/server/auth/session.ts`: `getSession()`, `requireUser()`, `getOrCreateGuestSession()`. Guest tokens are 256-bit random, stored **hashed**, set as `HttpOnly; Secure; SameSite=Lax; Path=/` with a 90-day expiry.
6. Ensure **every** request resolves to exactly one identity — an `app_user` or a `guest_session`, never both, never neither.
7. Implement the guest → authenticated transition: on sign-in, look up the guest session, run the registered upgrade handlers (Phase 5 registers the cart merge here), then invalidate the guest token and rotate the cookie. **Session fixation is prevented by rotating on every privilege change.**
8. Create the `app_users` row on first authenticated request, idempotently, so a Supabase user without a profile is impossible.
9. Password reset and email-change flows, both through Brevo.
10. **Forward the real client IP** to Supabase Auth, or call Auth from the browser (R13). Without this every customer shares Cloud Run's egress IP and one 30-per-5-minute token bucket — an effective global cap of ~6 sign-ins/minute. Decide explicitly and record it in the ADR log.
11. Application-layer rate limiting on sign-in, sign-up and password reset using `rate_limit_counters`.
12. Delete every trace of the cosmetic auth pattern; ensure nothing resembling `signIn('you@vokr.shop')` can exist.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/auth/*` · `vokr/src/app/api/auth/**` · `vokr/src/app/(auth)/**` · `vokr/src/middleware.ts`

#### Database Impact
Adds `app_users`, `guest_sessions`, `rate_limit_counters`.

#### API Impact
`POST /api/auth/signup` · `POST /api/auth/signin` · `POST /api/auth/signout`
· `POST /api/auth/reset` · `GET /api/auth/callback` (OAuth). All rate
limited, all returning through `toErrorResponse()`.

#### UI Impact
Real sign-in / sign-up / reset forms with actual password fields, validation
and error states. A real Google button.

#### Security Requirements
- Service-role key never reaches the browser — asserted by a bundle test.
- Guest tokens: cryptographically random, stored hashed, HttpOnly, Secure, SameSite.
- Session identifier rotates on every privilege change.
- Rate limits on all three auth endpoints.
- Sign-in and password-reset responses must not reveal whether an address is registered.
- Password minimum length and a breach-list check if available; no arbitrary composition rules.

#### Testing Requirements
- Unit: guest token generation, hashing, cookie attributes.
- Integration: signup → `app_users` row created exactly once, even on concurrent duplicate requests.
- Integration: guest session created, upgraded on sign-in, old token invalidated.
- Integration: rate limiter returns 429 at the threshold and recovers after the window.
- Security: no user enumeration through timing or message differences.
- **Manual, mandatory: a confirmation email delivered to an external address via Brevo, screenshotted.**

#### Validation
Sign up with a personal address unconnected to the Supabase project.
Receive the email. Reset the password. Sign in with Google. Confirm the
service-role key appears in zero client chunks (`grep` the build output).

#### Acceptance Criteria
- A real customer can create an account and **receive the email**.
- Guest browsing works with no account.
- Guest → authenticated transition preserves identity and rotates the token.
- Auth endpoints are rate limited.

#### Production Checklist Mapping
**R12** (Brevo custom SMTP — the highest-risk item), **R13** (auth rate
limit + client IP), part of **R19** (rate limiting).

#### Dependencies
Brevo account, verified domain, Google OAuth credentials.

#### Exit Criteria
**A signup confirmation email has arrived in an inbox that is not on the
Supabase project team.** Nothing less closes R12.

---

### PHASE 4 — Website / Page Migration

#### Status
**NOT STARTED**

#### Objective
Migrate the 27 legacy pages into shared Next.js layouts and components,
removing ~2 MB of duplication, every dead form and every piece of
fabricated content.

#### Why It Exists
The duplication has *already* caused a defect — the search index drifted
because it was copy-pasted 27 times. One deployable removes that entire
class of bug and eliminates the CORS and cookie-domain problems a separate
static frontend would create. It also closes **R20**, which is legal
exposure before it is engineering.

#### Prerequisites
Phase 2 (catalog data), Phase 3 (auth UI has somewhere to live).

#### Scope
26 of the 27 legacy pages: marketing, product, support and legal. One
design system extracted from the legacy CSS. Real forms bound to real
endpoints or honestly removed. `robots.txt`, `sitemap.xml`, per-route
metadata.

#### Explicitly Out of Scope
Cart and checkout UI (Phases 5–7). Image migration (Phase 14 — keep the
Shopify URLs temporarily and remove them there). Search behaviour (Phase 13).
**`gift-cards.html` — deferred by D1 (8 Sep 2026).** Not migrated, not
linked from `SiteHeader`/`SiteFooter`/anywhere, not reachable by any route.

#### Implementation Tasks
1. Inventory the 27 legacy pages; classify as marketing / product / support / legal; map each to a route. Exclude `gift-cards.html` (D1) — 26 pages migrate.
2. Extract the shared CSS into the Tailwind theme in `globals.css`. One source of truth for colour, type scale and spacing.
3. Build the real `SiteHeader` (navigation, search entry point, account and cart affordances) and `SiteFooter` (five `@vokr.shop` addresses).
4. Migrate marketing pages as Server Components. Static by default.
5. Migrate the 5 launch PDPs to a single dynamic `app/shop/[slug]/page.tsx` driven by the Phase 2 catalog. **One template, five products** — replacing five near-identical HTML files. `gift-cards.html` is not one of them (D1).
6. Migrate the support and legal pages, preserving the legal text verbatim except where §4 of this plan requires an amendment.
7. **R14: amend `terms.html`'s "order confirmation email/SMS" to "email".** SMS is deferred; leaving the copy is a contractual mismatch on day one.
8. **R20: delete the 10 fabricated reviews, the "4.7" average, the star breakdown and the "4,059 customer reviews" meta description.** Replace with an honest empty state. Real reviews land only after real orders, gated on `order_item_id`.
9. Audit every legacy claim against what will actually exist at launch — "250,000+ people", review counts, ratings, delivery promises. Anything unverifiable is removed or corrected. Record each change.
10. Every form either posts to a real endpoint or is removed. **Zero `onsubmit="return false;"` equivalents may survive.**
11. Per-route `generateMetadata`, canonical URLs, Open Graph. `app/robots.ts` and `app/sitemap.ts` generated from real routes.
12. Responsive pass at 360 / 768 / 1024 / 1440 px. Accessibility pass: landmarks, heading order, focus visibility, form labels, colour contrast.

#### Files / Areas Affected
`vokr/src/app/(marketing)/**` · `vokr/src/app/shop/[slug]/**` · `vokr/src/app/(support)/**` · `vokr/src/app/(legal)/**` · `vokr/src/components/**` · `vokr/src/app/robots.ts` · `vokr/src/app/sitemap.ts` · `vokr/src/styles/globals.css`

#### Database Impact
None. Reads the Phase 2 catalog.

#### API Impact
Consumes the catalog API. Forms that survive get real endpoints (newsletter,
contact) with validation and rate limiting.

#### UI Impact
The entire storefront. This is the largest UI phase.

#### Security Requirements
- Every surviving form: server-side validation, rate limiting, no reflected HTML.
- No `dangerouslySetInnerHTML` on any legacy content without sanitisation.
- External links `rel="noopener noreferrer"`.

#### Testing Requirements
- Component tests for header, footer, PDP template, size selector.
- Route tests: all 27 destinations return 200; no route 404s or 500s.
- Snapshot the legal page text so an accidental edit is caught.
- **Regression test asserting the strings "4,059", "4.7 average" and the fabricated reviewer names appear nowhere in the built output.**
- Accessibility: automated axe pass on every route, zero serious/critical violations.
- Responsive screenshots at the four breakpoints.

#### Validation
Crawl the built site; compare the route list against the 27-page inventory.
Grep the production build for fabricated content and for `cdn.shopify.com`
(expected to still be present — Phase 14 removes it).

#### Acceptance Criteria
- 26 pages reachable, no duplicated CSS/JS. `gift-cards.html` is not
  migrated and is not reachable by any route, nav link or sitemap entry.
- Zero dead forms.
- Zero fabricated reviews, ratings or review counts.
- `terms` says "email", not "email/SMS".
- `robots.txt` and `sitemap.xml` generated from real routes.

#### Production Checklist Mapping
**R14** (terms amendment), **R20** (remove fabricated reviews).

#### Dependencies
Phases 2 and 3.

#### Exit Criteria
The legacy site is fully represented by one application, with no invented
content and no inert form.

---

### PHASE 5 — Server-Side Cart

#### Status
**NOT STARTED**

#### Objective
A persistent server-side cart keyed by user or guest session, whose prices
are resolved server-side on every read.

#### Why It Exists
The legacy cart is an in-memory array keyed by display-name concatenation
that resets on navigation. **The class of pricing defect the legacy
gift-card page demonstrated dies in this phase** (the gift-card SKU itself
is deferred — D1 — but the underlying bug pattern, a client-controlled
price, applies to every SKU): once the cart stores only `variant_id` and
`quantity`, there is no mechanism by which a client can influence a price.

#### Prerequisites
Phases 2, 3.

#### Scope
`carts` and `cart_items`; add / update / remove / clear; guest-to-user cart
merge on sign-in; stock validation on add; server-side price and GST
resolution on every read; abandoned-cart pruning.

#### Explicitly Out of Scope
Inventory *reservation* (Phase 8 — the cart validates availability but holds
nothing). Checkout (Phase 6). Discount codes (**deferred**).

#### Implementation Tasks
1. Migration for `carts` and `cart_items` with the constraints in §3.5 — critically the partial unique indexes that make "one open cart per identity" a database guarantee rather than an application hope.
2. `src/server/cart/` service: `getCart()`, `addItem()`, `updateQuantity()`, `removeItem()`, `clearCart()`. **`cart_items` stores no price.**
3. `getCart()` joins to the catalog and computes, server-side, per line: unit price, line subtotal, per-variant GST, and the cart totals. GST uses `products.gst_rate_bps` per line — **never a shared constant.**
4. Validate on add: variant exists, is active, quantity within 1–10, and `quantity_on_hand - quantity_reserved >= requested`. Availability here is advisory; the authoritative check is the Phase 8 reservation.
5. Register the **cart merge** handler with the Phase 3 upgrade hook: on sign-in, union guest cart into user cart, summing quantities per variant, capped at the per-line maximum, then close the guest cart. Merge must be idempotent — a double-fired sign-in must not double quantities.
6. Cart API routes, all requiring an identity, all rate limited.
7. Cart UI: drawer or page, quantity controls, line removal, live totals, empty state, and an out-of-stock state per line.
8. Add abandoned-cart pruning to the Cloud Scheduler job-3 handler (built in Phase 17/18, registered here): carts untouched for 30 days.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/cart/*` · `vokr/src/app/api/cart/**` · `vokr/src/components/cart/**`

#### Database Impact
Adds `carts`, `cart_items`.

#### API Impact
`GET /api/cart` · `POST /api/cart/items` · `PATCH /api/cart/items/[id]` ·
`DELETE /api/cart/items/[id]` · `DELETE /api/cart`. **No endpoint accepts a
price, a total or a tax amount in its request body** — a test asserts this.

#### UI Impact
Real cart with real totals that survive navigation, reload and device change
for signed-in users.

#### Security Requirements
- Authorisation on every cart operation: the cart must belong to the caller's identity. **IDOR is the obvious attack here** — `cart_id` is never taken from the request.
- Request bodies validated with `zod`; unknown fields rejected, not ignored.
- Rate limit cart mutations.

#### Testing Requirements
- Unit: totals and per-line GST for mixed-slab carts (laces + shoes in one cart).
- Unit: a request body containing `price` is rejected, and the stored price is unaffected.
- Integration: add/update/remove; the partial unique index prevents a second open cart.
- Integration: guest → user merge, including the idempotency case.
- Integration: another identity's cart returns 404, not 403 (no existence disclosure).
- **Regression: reproduce the legacy client-controlled-pricing defect (originally observed on the now-deferred gift-card page) generically — POST a request body carrying a client-chosen `price`/`total` for a real variant and assert the stored line price and cart total come only from `product_variants.price_paise`, unaffected by the request body.**

#### Validation
Add items as a guest, sign in, confirm the cart merged exactly once. Attempt
to POST a price and confirm it changes nothing.

#### Acceptance Criteria
- Cart persists across navigation, reload and sessions.
- Prices and GST always resolve server-side.
- Merge on sign-in is correct and idempotent.
- No client input can alter a price.

#### Production Checklist Mapping
**R6** (server-side price resolution — behavioural half).

#### Dependencies
Phases 2, 3.

#### Exit Criteria
The legacy client-controlled-pricing defect is provably impossible for
every launch SKU, with a regression test pinning it.

---

### PHASE 6 — Address + Checkout Foundation

#### Status
**NOT STARTED**

#### Objective
Capture and validate a shipping address, determine PIN serviceability and
COD eligibility, and produce the **authoritative server-computed pricing
snapshot** that payment and order creation both derive from.

#### Why It Exists
`terms.html` already promises "courier serviceability at your PIN code —
check at checkout" and COD on eligible orders with a handling fee. Those are
contractual. This phase also creates the single artefact that makes the
money path auditable: one pricing snapshot that the Razorpay amount and the
order total are both read from, so they cannot disagree.

#### Prerequisites
Phases 2, 3, 5. **D2** (GST). Shiprocket account with COD enabled, for
serviceability data.

#### Scope
`addresses`, `checkout_sessions`; address form and validation; PIN
serviceability and COD eligibility; shipping fee and COD handling fee
rules; the pricing snapshot; checkout state machine.

#### Explicitly Out of Scope
Razorpay (Phase 7). Inventory reservation (Phase 8). Saved address book
(**deferred**). Discount codes (**deferred**).

#### Implementation Tasks
1. Migrations for `addresses` and `checkout_sessions`.
2. Address validation: required fields, Indian PIN format (6 digits, first digit 1–8), state from a fixed enumeration matching GST state codes, E.164-normalised phone.
3. PIN serviceability: a `serviceable_pincodes` lookup seeded from a Shiprocket export (manual at launch — the API is deferred). Returns serviceable / COD-eligible / estimated delivery days. **Unknown PIN must fail closed** — refuse the order rather than promising delivery Vokr cannot make.
4. Shipping fee rules from existing copy: free above ₹4,999, otherwise flat. COD handling fee as a separate, visible line.
5. `computePricing(cartId, address, paymentMethod)` → the snapshot: per-line unit price, quantity, line subtotal, `gst_rate_bps`, line tax, HSN; then subtotal, shipping, COD fee, total. **Rounding is defined once**, at the line level, in paise, half-up, and the total is the sum of rounded lines — never a rounded sum.
6. GST split: **CGST + SGST when the ship-to state equals the seller state, IGST otherwise.** Requires the registered seller state from D3.
7. Persist the snapshot on `checkout_sessions.pricing_snapshot` with an `expires_at` (15 minutes). Everything downstream reads it; nothing recomputes independently.
8. Checkout state machine: `draft → address_captured → priced → reserved → payment_pending → paid | failed | expired | abandoned`. Illegal transitions throw; every transition is logged.
9. Checkout UI: address step, delivery/COD step, review step with the full GST breakdown, all totals from the server.
10. `idempotency_key` accepted on session creation, unique-constrained.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/checkout/*` · `vokr/src/server/pricing/*` · `vokr/src/server/shipping/serviceability.ts` · `vokr/src/app/checkout/**` · `vokr/src/app/api/checkout/**`

#### Database Impact
Adds `addresses`, `checkout_sessions`, `serviceable_pincodes`.

#### API Impact
`POST /api/checkout/session` (idempotent) · `PUT /api/checkout/session/[id]/address`
· `GET /api/checkout/session/[id]/pricing` · `GET /api/shipping/serviceability?pincode=`.

#### UI Impact
The full checkout flow up to, but excluding, payment.

#### Security Requirements
- Checkout sessions are bound to the caller's identity; another identity gets 404.
- The serviceability endpoint is rate limited — it is an unauthenticated lookup and therefore a scraping and enumeration target.
- Address PII encrypted at rest.
- **No pricing field is ever accepted from the client.** The snapshot is the only pricing input downstream.

#### Testing Requirements
- Unit: pricing for every combination — mixed GST slabs, free-shipping threshold either side, COD fee, intra-state vs inter-state split.
- Unit: rounding. Assert `sum(rounded lines) == total` for adversarial values.
- Unit: state machine rejects every illegal transition.
- Integration: unknown PIN fails closed.
- Integration: the same idempotency key returns the same session, never a second one.
- Security: another user's checkout session is inaccessible.

#### Validation
Place a checkout for a cart mixing ₹295 laces and ₹9,995 shoes; verify each
line's GST independently against the D2 rates. Verify an intra-state and an
inter-state address produce CGST+SGST and IGST respectively.

#### Acceptance Criteria
- Address captured, validated, serviceability checked.
- One authoritative pricing snapshot per checkout session.
- Per-variant GST, correctly split by state.
- Totals reconcile exactly.

#### Production Checklist Mapping
**R6**, **R11** (GST per variant — computation half), **R8** (idempotency —
begins here).

#### Dependencies
D2, D3 (seller state), Shiprocket serviceability export.

#### Exit Criteria
Two independent readers of `pricing_snapshot` — payment and order creation —
cannot arrive at different numbers.

---

### PHASE 7 — Razorpay Payments

#### Status
**NOT STARTED**

#### Objective
Take real money: Razorpay order creation with idempotency, browser
checkout, and **webhook-driven payment state with verified signatures.**

#### Why It Exists
This and Phase 8 are the highest-risk work in the programme. The rules here
exist because the failure modes are expensive and quiet: a browser callback
that is trusted becomes a free-order exploit; an unverified webhook becomes
a forged-payment exploit; a missing idempotency key becomes a double charge
on a flaky Indian mobile network.

#### Prerequisites
Phase 6. Razorpay account (test mode). **D3** for live mode.

#### Scope
`payments`, `webhook_events`; Razorpay Orders API; the browser checkout
handoff; the webhook endpoint with signature verification and idempotent
processing; the payment state machine; failure, retry and duplicate
handling; COD as a payment method that skips Razorpay.

#### Explicitly Out of Scope
Order creation (Phase 9 — this phase records payment facts; Phase 9 turns
them into orders). Refunds beyond the manual path (Phase 12). Subscriptions
(**deferred** — e-Mandate/UPI AutoPay is its own project).

#### Implementation Tasks
1. Migrations for `payments` and `webhook_events` with their unique constraints. **`UNIQUE(provider, provider_event_id)` is the idempotency mechanism, not a nicety.**
2. `src/server/payments/razorpay.ts`: a thin typed client. Amount comes **only** from `pricing_snapshot.total_paise`.
3. Create the Razorpay order with the checkout session's `idempotency_key` as `receipt`. **This network call happens outside any database transaction and outside any row lock (R9).**
4. Persist the `payments` row before returning to the browser, so a payment can never exist at Razorpay without a local record.
5. Browser checkout with the Razorpay SDK using `NEXT_PUBLIC_RAZORPAY_KEY_ID`. **The browser callback updates the UI only.** It sets no payment state, creates no order, and grants nothing.
6. `POST /api/webhooks/razorpay`: read the **raw body** before any JSON parsing, verify the HMAC-SHA256 signature against `RAZORPAY_WEBHOOK_SECRET` using a **constant-time comparison**, then insert into `webhook_events`. A duplicate `provider_event_id` returns 200 immediately without reprocessing.
7. Process events in a transaction: `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`, `refund.processed`. Unknown types are stored and acknowledged, never rejected.
8. Payment state machine: `created → authorized → captured | failed | refunded`. Backward transitions are rejected. **Out-of-order delivery is expected** — Razorpay does not guarantee ordering, so processing must be commutative or explicitly ordered by event timestamp.
9. Always return 2xx once an event is durably stored. Returning 5xx triggers Razorpay retries that pile up behind a bug.
10. Reconciliation job: checkout sessions in `payment_pending` beyond 30 minutes are queried against the Razorpay API and resolved. Covers the case where a webhook is never delivered.
11. COD: skip Razorpay entirely, mark `payment_method = 'cod'`, `payment_status = 'pending'`, and proceed to order creation.
12. Staging uses Razorpay **sandbox** credentials; production uses live. Enforced by `env.ts` (R5).

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/payments/*` · `vokr/src/app/api/payments/**` · `vokr/src/app/api/webhooks/razorpay/route.ts` · `vokr/src/components/checkout/payment-step.tsx`

#### Database Impact
Adds `payments`, `webhook_events`.

#### API Impact
`POST /api/payments/razorpay/order` (idempotent) ·
`POST /api/webhooks/razorpay` (unauthenticated, signature-verified, **CSRF
exempt and excluded from any body-parsing middleware**).

#### UI Impact
Payment step; success, failure and pending states. Pending is a real state
that must be shown honestly, not optimistically resolved.

#### Security Requirements
- Signature verified on **every** webhook, constant-time, on the raw body.
- `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only; a bundle test asserts they never appear client-side.
- Replay protection via the unique event ID.
- **The browser callback is untrusted input.** A test asserts that forging a success callback grants nothing.
- Webhook endpoint rate limited and IP-observed, but never IP-allowlisted as the *only* control.
- Amounts logged; card and UPI details never logged.

#### Testing Requirements
- Unit: signature verification accepts a valid signature and rejects a tampered body, a wrong secret, a missing header and a truncated signature.
- Unit: state machine rejects backward and illegal transitions.
- Integration: the same webhook delivered five times produces exactly one state change.
- Integration: out-of-order delivery (`captured` before `authorized`) converges to the correct state.
- Integration: the same idempotency key never creates two Razorpay orders.
- **Security: a forged browser callback with a fabricated payment ID creates no order and grants nothing.**
- Integration: reconciliation resolves a session whose webhook never arrived.
- End-to-end in Razorpay **test mode**: success, failure, and user-abandoned payment.

#### Validation
Drive real test-mode payments. Replay captured webhook payloads. Tamper
with a payload by one byte and confirm rejection. Kill the browser mid-payment
and confirm the webhook still resolves the state correctly.

#### Acceptance Criteria
- Payment state is driven **only** by verified webhooks.
- Duplicate webhooks are inert.
- No double-charge is reachable under retry.
- Test-mode payments complete end to end.

#### Production Checklist Mapping
**R7** (webhook signature verification), **R8** (idempotency keys),
**R16** (live-mode KYC — tracked here, completed before launch).

#### Dependencies
Razorpay account; D3 for live mode.

#### Exit Criteria
No sequence of browser-side actions can change payment state, and no
sequence of webhook deliveries can produce a duplicate charge.

---

### PHASE 8 — Inventory + Concurrency Hardening

#### Status
**NOT STARTED**

#### Objective
Make overselling impossible: reservation inside a database transaction with
`SELECT … FOR UPDATE`, `CHECK` constraints as the backstop, and the Razorpay
call provably outside the lock.

#### Why It Exists
The legacy site has no inventory concept whatsoever — sizes 4–11 render
unconditionally and nothing is ever sold out. The PDF is explicit that
application logic alone is insufficient: the database constraint is the
backstop that catches the bug the application logic will eventually have.

#### Prerequisites
Phases 2, 5, 6, 7.

#### Scope
`inventory_reservations`; the reservation transaction; reservation expiry;
commit and release on payment outcome; sold-out UI; the third Cloud
Scheduler job.

#### Explicitly Out of Scope
Multi-warehouse (single location at launch). Backorders. Restock
notifications (**deferred**).

#### Implementation Tasks
1. Migration for `inventory_reservations`. Confirm the Phase 2 `CHECK` constraints are present and active — re-assert them in a test rather than trusting the earlier migration.
2. `reserveInventory(checkoutSessionId)`, executed on the **direct/session connection**, not the transaction-mode pooler. `SELECT … FOR UPDATE` needs a session that holds the lock for the transaction's duration; pgbouncer transaction mode is acceptable for the statement but the direct connection is what the PDF specifies for checkout, and it removes the whole class of pooler-interaction doubt.
3. The transaction body, exactly as §3.5 specifies, with **`ORDER BY variant_id`** on the locking select. Without a deterministic lock order, two carts holding the same two variants in opposite order deadlock — and Phase 21 will find it at 25 concurrent buyers.
4. Reservations expire after 15 minutes. `expires_at` is set inside the transaction.
5. **Assert structurally that the Razorpay call is outside the lock**: `reserveInventory()` returns before `createRazorpayOrder()` is invoked, and a lint rule or architecture test forbids importing the payments client from the inventory module. The PDF calls this "worth more than any infrastructure choice for checkout throughput".
6. Commit reservations on `payment.captured` (decrement `quantity_on_hand`, decrement `quantity_reserved`, mark `committed`). Release on failure, expiry or abandonment.
7. Cloud Scheduler job 3 handler: expire stale reservations, prune abandoned carts, prune rate-limit rows, prune old webhook events and guest sessions. One endpoint, authenticated by an OIDC token from the scheduler's service account — **never a shared bearer secret in a query string.**
8. Sold-out UI: disabled sizes on the PDP, per-line out-of-stock state in the cart, and a clear checkout-time message when a reservation cannot be granted.
9. Structured logging on every reservation grant, denial, commit and release, with the variant ID and the resulting quantities. This is the audit trail that makes an overselling report investigable.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/inventory/*` · `vokr/src/server/checkout/reserve.ts` · `vokr/src/app/api/jobs/maintenance/route.ts` · `vokr/src/components/pdp/size-selector.tsx`

#### Database Impact
Adds `inventory_reservations`. Adds the expiry index. No schema change to
`inventory` — its constraints came from Phase 2 deliberately.

#### API Impact
`POST /api/checkout/session/[id]/reserve` · `POST /api/jobs/maintenance`
(OIDC-authenticated, scheduler only).

#### UI Impact
Sold-out states everywhere stock is shown. Honest messaging when a
reservation lapses during payment.

#### Security Requirements
- The maintenance endpoint authenticates the Cloud Scheduler service account via OIDC.
- Reservation quantities are bounded per identity to prevent a denial-of-inventory attack: a single actor must not be able to reserve the entire stock of a variant.
- Reservation attempts are rate limited.

#### Testing Requirements
- Integration: two concurrent reservations for the last unit — exactly one succeeds.
- Integration: the `CHECK` constraint rejects an over-decrement even when application logic is deliberately bypassed. **Test the backstop, not just the happy path.**
- Integration: deadlock test — two carts, two shared variants, opposite insertion order, run concurrently. Must not deadlock.
- Integration: reservations expire and return stock.
- Integration: commit on capture, release on failure.
- **Architecture test: the payments module is unreachable from the inventory transaction.**
- The full concurrency suite is exercised again under load in **Phase 21**.

#### Validation
Set a variant to `quantity_on_hand = 1`. Run 10 concurrent checkouts. Assert
exactly one reservation, nine clean denials, zero errors, and final stock of
exactly 0 or 1 — never negative.

#### Acceptance Criteria
- Overselling is impossible at both the application and database layers.
- Razorpay is never called while a row lock is held.
- Expired reservations return stock automatically.
- Sold-out is visible to customers.

#### Production Checklist Mapping
**R9** (reservation in a transaction with the `CHECK` backstop), and the
correctness precondition for **R10**.

#### Dependencies
Phases 6, 7.

#### Exit Criteria
A concurrency test at 10 buyers on one unit passes deterministically, and
the `CHECK` constraint has been proven to fire.

---

### PHASE 9 — Orders

#### Status
**NOT STARTED**

#### Objective
Turn a paid or COD-confirmed checkout into a durable order, with a state
machine, customer-facing order numbers, guest lookup and order history.

#### Why It Exists
The legacy "order tracking" is an inert form beside four descriptive divs —
not a tracker, not a state machine, no lookup. Everything operational
downstream (fulfilment, email, admin, returns) reads orders.

#### Prerequisites
Phases 6, 7, 8.

#### Scope
`orders`, `order_items`, `order_status_history`; order creation driven by
verified payment; `VK-#####` numbering; the status state machine; guest
lookup (rate-limited, enumeration-resistant); authenticated order history;
GST-compliant invoices.

#### Explicitly Out of Scope
Courier integration (Phase 10). Emails (Phase 11). Admin transitions
(Phase 12). Returns *processing* (Phase 10). Store credit unless D1 = (b).

#### Implementation Tasks
1. Migrations for `orders`, `order_items`, `order_status_history`.
2. `order_number` from a Postgres sequence formatted `VK-#####`, matching the `VK-10234` format already in the legacy UI. Unique, never reused, no information disclosed by the value beyond ordinality.
3. Create the order **inside the webhook processing transaction** for prepaid, and at confirmation for COD. It is derived entirely from `pricing_snapshot` — never recomputed, so the order total and the amount charged cannot diverge.
4. Snapshot every line: unit price, tax, GST rate, HSN, product name, variant label. An order must render identically in three years after a rename, reprice or delete.
5. Order status machine: `confirmed → preparing → shipped → delivered`, plus `cancelled`, `returned`, `refunded`, `rto`. Matches the four-step tracker the legacy UI already draws. Every transition writes `order_status_history` with an actor.
6. **Guest order lookup** — `order_number` + email, unauthenticated by design because the returns page promises "no login required". Therefore: strict rate limit per IP *and* per order number, **constant-time comparison, a uniform response for every failure, and a deliberate uniform delay** so a valid order number cannot be distinguished from an invalid one by timing or message. Lock out an order number after repeated failures.
7. Authenticated order history and detail for signed-in users.
8. **GST-compliant invoice (R11)**: sequential invoice numbering with no gaps, seller GSTIN and registered address, buyer details, per-line HSN and GST rate, CGST/SGST or IGST split, and totals in words. Rendered as a PDF stored in R2 (Phase 14) or generated on demand.
9. Reconcile: an order must exist for every captured payment, and a captured payment for every prepaid order. A daily check reports any orphan on either side.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/orders/*` · `vokr/src/server/invoicing/*` · `vokr/src/app/api/orders/**` · `vokr/src/app/orders/**` · `vokr/src/app/(support)/order-status/**`

#### Database Impact
Adds `orders`, `order_items`, `order_status_history`, and the order-number
and invoice-number sequences.

#### API Impact
`POST /api/orders/lookup` (guest, heavily rate limited) ·
`GET /api/orders` (authenticated) · `GET /api/orders/[orderNumber]` ·
`GET /api/orders/[orderNumber]/invoice`.

#### UI Impact
Order confirmation page; guest order status tracker (the legacy four-step
UI, now real); authenticated order history and detail; invoice download.

#### Security Requirements
- **Guest lookup is the most exposed endpoint in the application.** Rate limited per IP and per order number, enumeration-resistant, uniform responses and uniform timing, with lockout.
- Authenticated order access checks ownership on every read.
- Invoices are served through an authorisation check, never from a guessable public URL.
- Order numbers are sequential and therefore guessable — **the email is the second factor and must be compared in constant time.**

#### Testing Requirements
- Integration: `payment.captured` → exactly one order, even on webhook replay.
- Integration: order totals equal the pricing snapshot to the paise.
- Integration: the status machine rejects illegal transitions.
- **Security: enumeration test — 100 lookups mixing valid and invalid order numbers show no statistically significant difference in response time or body.**
- Security: rate limit triggers and locks out.
- Security: user A cannot read user B's order.
- Unit: invoice numbering has no gaps under concurrent creation.
- Unit: invoice GST arithmetic and the intra/inter-state split.

#### Validation
Complete a test-mode purchase end to end; verify the order, its history and
its invoice. Attempt to enumerate order numbers and confirm the limiter and
the uniform responses hold.

#### Acceptance Criteria
- Every captured payment produces exactly one order.
- Guest lookup works, is rate limited and reveals nothing.
- Invoices are GST-compliant and sequentially numbered.
- Order and payment records reconcile exactly.

#### Production Checklist Mapping
**R11** (compliant invoice), **R19** (order-lookup rate limiting).

#### Dependencies
Phases 7, 8. D3 for the seller GSTIN and registered address.

#### Exit Criteria
Payments and orders reconcile with zero orphans, and guest lookup survives
an enumeration attempt.

---

### PHASE 10 — Fulfilment + COD + Shiprocket Operations

#### Status
**NOT STARTED**

#### Objective
Make orders shippable through Shiprocket's manual panel, with COD, PIN
serviceability, returns, exchanges, RTO and refunds handled as real
operational processes.

#### Why It Exists
Without a courier there is no COD, no serviceability, no tracking, no RTO
handling and no return labels — four promises already written into
`terms.html`. The PDF is explicit that manual panel operation is acceptable
at launch and that API integration waits for volume; RTO on COD (15–25% of
COD orders, ₹100–150 lost each) is the real cost centre, not infrastructure.

#### Prerequisites
Phases 6, 9. Shiprocket account live with COD enabled.

#### Scope
Order export for the Shiprocket panel; tracking number and status capture;
COD lifecycle including remittance reconciliation; return and exchange
request flow; RTO handling; refund initiation; the documented runbook.

#### Explicitly Out of Scope
**Shiprocket API integration — deliberately deferred** (§10 trigger: ~600+
orders/month). Automated label generation. Multi-courier routing.

#### Implementation Tasks
1. `returns_exchanges` table: `order_id`, `order_item_id`, type, reason, state, requested size, timestamps.
2. Admin-side CSV export in Shiprocket's manual-upload format (Phase 12 hosts the UI; the export logic lives here).
3. Manual entry of AWB/tracking number and courier against an order; transition to `shipped` writes history and triggers the Phase 11 email.
4. Tracking display on the order status page — the four-step tracker driven by real `order_status_history` rows.
5. COD lifecycle: `confirmed → shipped → delivered → cod_collected → remitted`. Remittance is reconciled against Shiprocket payouts; an unreconciled COD order is a visible exception, not a silent one.
6. RTO: `rto_initiated → rto_received`, restock decision, and the re-ship charge the terms already describe.
7. Return/exchange request flow honouring "no login required" — same enumeration-resistant lookup as Phase 9. Request → approve → label → receipt → refund or exchange dispatch.
8. Refund initiation: Razorpay refund API for prepaid; for COD, bank transfer or store credit per the terms (**store credit requires D1/the ledger**). Every refund is recorded against the payment and the order.
9. COD abuse controls: a blocklist keyed on phone and PIN, per the terms' existing COD-blacklist clause, plus a COD order-value ceiling.
10. **Write the operational runbook**: daily order export, panel upload, AWB entry, exception handling, remittance reconciliation, RTO processing. Manual operation is only acceptable if it is *documented* — otherwise it is one person's memory.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/src/server/fulfilment/*` · `vokr/src/server/returns/*` · `vokr/src/app/api/returns/**` · `vokr/docs/runbooks/fulfilment.md`

#### Database Impact
Adds `returns_exchanges`, `cod_remittances`, `cod_blocklist`; adds
tracking columns to `orders`.

#### API Impact
`POST /api/returns/request` (guest-capable, rate limited) ·
`GET /api/returns/[id]` · admin transition endpoints (Phase 12).

#### UI Impact
Real order tracking; return/exchange request form; return status.

#### Security Requirements
- Return lookup carries the same enumeration resistance as order lookup.
- Refund initiation is an admin-only, audit-logged action with a second confirmation.
- COD blocklist data is PII and falls under the Phase 17 retention rules.

#### Testing Requirements
- Integration: the full COD lifecycle including remittance.
- Integration: RTO restocks inventory correctly.
- Integration: return request → approval → refund updates order, payment and (if applicable) ledger consistently.
- Integration: refund amount can never exceed the captured amount.
- Security: return lookup enumeration resistance.
- Manual: one real order pushed through the Shiprocket panel end to end.

#### Validation
Run one live order through the complete manual process and time it. If a
day's orders cannot be processed in a reasonable window, the API deferral
needs revisiting — record the measurement.

#### Acceptance Criteria
- Orders reach Shiprocket and get real tracking.
- COD orders reconcile to remittance.
- Returns, exchanges and RTO work end to end.
- The runbook is written and has been followed by someone who did not write it.

#### Production Checklist Mapping
**R15** (courier operational with COD and PIN serviceability).

#### Dependencies
Shiprocket account. D1 if refunds route to store credit.

#### Exit Criteria
A real order has been shipped, tracked and delivered through the manual
process, by someone following the runbook.

---

### PHASE 11 — Transactional Email

#### Status
**NOT STARTED**

#### Objective
Send every transactional email through Brevo, reliably, within the 300/day
free cap, with delivery visibility.

#### Why It Exists
`terms.html` promises an order confirmation with the order ID. Brevo's cap
is a **daily** one, and its failure mode is that confirmations silently stop
— which is why alerting at 200/day matters more than the monthly average.

#### Prerequisites
Phases 3 (Brevo already configured as Auth SMTP), 9, 10.

#### Scope
Brevo transactional API; templates for confirmation, shipped, delivered,
return approved, refund processed and COD confirmation; a send log; retry;
volume alerting.

#### Explicitly Out of Scope
Marketing email. SMS (**deferred**, R14 amends the copy). A background queue
(**deferred** to ~300–500 orders/day).

#### Implementation Tasks
1. `src/server/email/brevo.ts` — typed client with timeout, bounded retry and structured logging.
2. `email_log` table: recipient hash, template, `order_id`, provider message ID, status, attempts, timestamps. **Never store the rendered body** — it is full of PII and Supabase storage is a cumulative 500 MB.
3. Templates, all plain-text-first with an HTML alternative: order confirmation (with order number and full GST breakdown), shipped (with AWB and tracking link), delivered, return approved, refund processed, COD order confirmed.
4. Send from the order state machine's transitions, not scattered call sites. One transition, one email, enforced by a uniqueness key on `(order_id, template)`.
5. Email sending must **never** fail an order. Sends happen after commit; a failure is logged and retried, never rolled back into the payment path.
6. Bounded in-process retry with backoff. If a send is still failing, it becomes a visible operational exception in the admin panel.
7. Brevo webhook for bounces, spam reports and delivery confirmations → `email_log`.
8. **Daily volume counter with an alert at 200 sends** (PDF guardrail). At ~4 emails/order the 300/day cap binds at roughly 70–75 orders/day; the mitigation is one month of Brevo Starter at $9, pre-authorised.
9. Verify whether free-plan transactional email carries Brevo branding — the PDF marks this `UNVERIFIED`. **Send yourself a real order confirmation and look at it.**

#### Files / Areas Affected
`vokr/src/server/email/*` · `vokr/src/emails/**` · `vokr/src/app/api/webhooks/brevo/route.ts` · `vokr/prisma/schema.prisma`

#### Database Impact
Adds `email_log` (pruned at 180 days).

#### API Impact
`POST /api/webhooks/brevo` (signature-verified).

#### UI Impact
None customer-facing. Admin sees send status per order.

#### Security Requirements
- No PII beyond what the email needs; rendered bodies are never persisted.
- The Brevo webhook is signature-verified like Razorpay's.
- `BREVO_API_KEY` is server-only.
- Email addresses are hashed in logs and metrics.

#### Testing Requirements
- Unit: every template renders with correct order data and GST breakdown.
- Integration: an order transition sends exactly one email; a repeated transition sends none.
- Integration: a send failure does not roll back or fail the order.
- Integration: the daily counter increments and the 200 alert fires.
- **Manual, mandatory: receive a real order confirmation at an external address and inspect it for branding and correctness.**

#### Validation
Complete a test purchase; receive the confirmation; check the GST breakdown
matches the invoice exactly.

#### Acceptance Criteria
- All six transactional emails send and arrive.
- Exactly one email per transition.
- Email failure never affects order integrity.
- The 200/day alert is live.

#### Production Checklist Mapping
Supports **R12** (same provider), and the "order confirmation email"
commitment in the legal copy.

#### Dependencies
Brevo account with verified domain and DNS records.

#### Exit Criteria
A real order confirmation, with correct GST, has arrived in an external
inbox.

---

### PHASE 12 — Admin / Operations

#### Status
**NOT STARTED**

#### Objective
An internal panel to see and operate the store: orders, status transitions,
inventory adjustment, manual refunds, customer lookup.

#### Why It Exists
The PDF puts this in "recommended but not blocking" while adding that "you
cannot operate a store you cannot see into" and that raw database access is
a stopgap for the first days only. Treating it as blocking-in-practice is
the honest reading — Phase 10's manual fulfilment depends on it.

#### Prerequisites
Phases 8, 9, 10, 11.

#### Scope
Admin authentication and authorisation; order list and detail; status
transitions; inventory adjustment; manual refunds; customer lookup;
Shiprocket export; email and webhook exception views; the audit log.

#### Explicitly Out of Scope
Analytics dashboards. Bulk editing. Anything visual beyond legible. Product
CRUD beyond price and stock (the launch catalog is five SKUs — a migration
is a reasonable way to change it).

#### Implementation Tasks
1. Admin role on `app_users` plus an `admin_sessions` concept with a **short idle timeout**. Admin authorisation is checked server-side on every request and every action — never inferred from a client-side route.
2. Order list with filters (status, payment method, date, exception) and search by order number, email or phone.
3. Order detail: lines, payment, history, emails sent, tracking, invoice.
4. Status transitions through the same state machine as the rest of the system — the admin panel gets no privileged shortcut past invalid transitions.
5. Inventory adjustment with a mandatory reason, written to `audit_log`. This is also how launch stock is entered.
6. Manual refund with a second confirmation and a hard cap at the captured amount.
7. Customer lookup with a **PII reveal that is itself audit-logged** — viewing a customer's address is a recorded event.
8. Exception views: payments without orders, orders without payments, failed emails, unprocessed webhooks, unreconciled COD. These are the screens that make an incident tractable at 2 a.m.
9. Shiprocket CSV export (Phase 10's logic, Phase 12's button).
10. `audit_log` writes on every admin mutation: actor, entity, action, before, after.

#### Files / Areas Affected
`vokr/src/app/admin/**` · `vokr/src/server/admin/*` · `vokr/src/server/audit/*` · `vokr/src/middleware.ts`

#### Database Impact
Adds `audit_log`; adds the admin role column.

#### API Impact
`/api/admin/**`, all authorised, all audit-logged, all rate limited.

#### UI Impact
An internal panel. Functional, not attractive.

#### Security Requirements
- **`/admin` and `/api/admin` blocked at Cloudflare** to a restricted set (Phase 20 WAF rule) in addition to application authorisation. Defence in depth for the highest-value surface in the system.
- Every mutation audit-logged with the actor.
- PII reveals audit-logged.
- Short session timeout; re-authentication for refunds.
- No admin route is ever statically rendered or cached.

#### Testing Requirements
- Security: a non-admin user receives 404 on every admin route and endpoint.
- Security: an unauthenticated request receives 404, not a login redirect that confirms the path exists.
- Integration: every mutation writes an audit row.
- Integration: refunds cannot exceed the captured amount.
- Integration: illegal status transitions are rejected in the admin path too.

#### Validation
Operate a full order lifecycle exclusively through the admin panel, without
touching the database.

#### Acceptance Criteria
- Orders can be found, inspected and transitioned.
- Stock can be adjusted with a recorded reason.
- Refunds are possible, capped and audited.
- Exception views surface every inconsistency class.

#### Production Checklist Mapping
PDF §8 "internal admin panel" and "audit log on orders and payments".

#### Dependencies
Phases 9, 10, 11.

#### Exit Criteria
The store is fully operable without database access.

---

### PHASE 13 — Search + Catalog Performance

#### Status
**NOT STARTED**

#### Objective
One static JSON search index generated from the database, plus a measured
Supabase egress budget.

#### Why It Exists
The legacy "search" is a 13-entry array duplicated across 27 files that has
already drifted: 4 pages carry 15 entries including two products that do not
exist. Postgres FTS and any search engine are over-specified for 13
searchable entries. The real defect is duplication, and the fix is one
generated source of truth.

#### Prerequisites
Phases 2, 4.

#### Scope
Index generation at build time from the catalog plus a static list of
support pages; a single served JSON document; client-side filtering; the
catalog cache verified under load; an egress budget test.

#### Explicitly Out of Scope
**Any search engine. Postgres full-text search.** Both are deferred to ~50+
SKUs (§10). Faceted search. Typo tolerance beyond simple normalisation.

#### Implementation Tasks
1. `scripts/build-search-index.ts`: reads `products` and `product_variants`, merges a hand-maintained list of support/marketing entries, and emits one JSON document. Run at build time and on catalog change.
2. **Regenerate rather than hand-edit.** A test asserts that every product entry in the index corresponds to a live product and that every live product appears — this is precisely the drift check the legacy site lacked.
3. Serve from a single cached route with a long `Cache-Control` and a content hash, so Cloudflare serves it and Cloud Run rarely does.
4. Client-side filtering over the fetched index — no server round-trip per keystroke.
5. Search UI in the header with keyboard navigation and an accessible combobox pattern.
6. Verify the Phase 2 in-process catalog cache under concurrent load: a cold instance receiving 80 simultaneous requests must issue one database query, not eighty. Single-flight, proven by test.
7. **Egress budget test**: measure bytes returned by Supabase per pageview for the homepage, a PDP, and a cart view. The PDF's headroom model assumes ~5 KB/pageview average with caching versus ~20 KB without. Record the real number; it decides whether the 250,000 or 1,000,000 pageview ceiling applies.
8. Add explicit indexes for every query the storefront issues; confirm with `EXPLAIN ANALYZE` that no sequential scan occurs on a hot path.

#### Files / Areas Affected
`vokr/scripts/build-search-index.ts` · `vokr/src/app/api/search/index/route.ts` · `vokr/src/components/search/**` · `vokr/src/server/catalog/cache.ts`

#### Database Impact
Indexes only. No new tables.

#### API Impact
`GET /api/search/index` — one cached document.

#### UI Impact
Working search with real results and no phantom products.

#### Security Requirements
- The index is public data only. A test asserts it contains no unpublished product, no cost price and no internal field.
- The route is cacheable and rate limited at the edge.

#### Testing Requirements
- Unit: generated index matches the catalog exactly — no phantom entries, no missing products. **This is the regression test for the legacy drift.**
- Unit: search matching, ranking and normalisation.
- Integration: single-flight cache issues one query for N concurrent misses.
- Performance: measured Supabase bytes per pageview, recorded in the evidence log.
- Accessibility: combobox keyboard navigation and screen-reader announcements.

#### Validation
Search for "Model 251" and "Masks" — **both must return nothing**, because
neither product exists. Confirm the index regenerates when the catalog
changes.

#### Acceptance Criteria
- One index, generated, never hand-edited.
- No phantom products.
- Catalog cache verified single-flight.
- Measured egress per pageview recorded.

#### Production Checklist Mapping
**R18** (catalog cached in Cloud Run memory) — verified here under load.

#### Dependencies
Phases 2, 4.

#### Exit Criteria
The drift defect is structurally impossible and the egress number is
measured rather than assumed.

---

### PHASE 14 — R2 + Asset Migration

#### Status
**NOT STARTED**

#### Objective
Move all 84 images off `cdn.shopify.com` to Cloudflare R2, re-encoded as
WebP/AVIF with responsive sizes, and bring the homepage under 500 KB.

#### Why It Exists
The codebase hotlinks 84 images from a third party's CDN that can break
without warning and is not Vokr's to depend on. The 19.9 MB base64 homepage
variant must never exist in production. R2 has zero egress at any volume,
which is also what keeps Cloud Run's Mumbai egress bill near zero.

#### Prerequisites
Phase 4. Cloudflare account with R2 enabled and a custom domain on the
bucket.

#### Scope
R2 buckets; image inventory and re-encoding; upload pipeline; `next/image`
with a custom loader; responsive sizes; cache headers; homepage weight
budget; the backup bucket (used by Phase 18).

#### Explicitly Out of Scope
User-uploaded content. Review photos (**deferred**). Video. On-the-fly
transformation (pre-generate the sizes instead).

#### Implementation Tasks
1. Create two R2 buckets: `vokr-assets` (public, custom domain, immutable long cache) and `vokr-backups` (private, lifecycle rules).
2. Inventory all 84 Shopify references and the 10 base64 images; map each to the product and role it serves.
3. Re-encode to AVIF with a WebP fallback, at responsive widths (e.g. 400/800/1200/1600). Content-hashed filenames so cache headers can be immutable.
4. Upload script with a manifest, safe to re-run.
5. `product_images` table: `variant_id` or `product_id`, `role`, `r2_key`, `width`, `height`, `alt`, `position`. **Keys and metadata only — never bytes.**
6. Custom `next/image` loader pointing at the R2 custom domain. Correct `sizes` on every image so mobile does not download desktop assets.
7. **Explicit alt text on every image.** The legacy markup is inconsistent here and it is both an accessibility and an SEO defect.
8. Cache headers: `public, max-age=31536000, immutable` for hashed assets. Cloudflare cache rules on the asset domain.
9. **Homepage weight budget (R21): under 500 KB total transfer.** Enforced by an automated check in CI that fails the build if exceeded.
10. Remove every `cdn.shopify.com` reference. A build-time grep failing on any match makes regression impossible.

#### Files / Areas Affected
`vokr/scripts/upload-assets.ts` · `vokr/src/lib/image-loader.ts` · `vokr/prisma/schema.prisma` · `vokr/next.config.ts` · every component rendering an image

#### Database Impact
Adds `product_images`.

#### API Impact
None — images are served directly from R2 via Cloudflare.

#### UI Impact
Real product photography, correctly sized, fast on mobile.

#### Security Requirements
- R2 credentials are server-only and used only by the upload script and the backup job.
- The assets bucket is public **read-only**; write requires credentials.
- No PII in filenames or metadata.
- The backup bucket is private with no public access, ever.

#### Testing Requirements
- Build check: **zero** occurrences of `cdn.shopify.com` in the output.
- Build check: **zero** base64 image data URIs above a small threshold.
- Performance: homepage transfer < 500 KB, asserted in CI.
- Accessibility: every image has meaningful alt text.
- Integration: the image loader produces correct R2 URLs for every size.

#### Validation
Lighthouse on the homepage and a PDP, mobile profile. Measure transfer size.
Confirm images load with the Shopify domain blocked at the network level.

#### Acceptance Criteria
- Zero third-party image dependencies.
- Homepage under 500 KB.
- Responsive images with correct `sizes`.
- No image bytes in Postgres.

#### Production Checklist Mapping
**R21** (homepage under 500 KB, images migrated to R2). Prepares the bucket
for **R17**.

#### Dependencies
Cloudflare R2, custom domain, real product photography.

#### Exit Criteria
Blocking `cdn.shopify.com` at the network layer changes nothing about how
the site renders.

---

### PHASE 15 — Observability + Logging

#### Status
**NOT STARTED**

#### Objective
Know what the application is doing in production: Sentry with PII scrubbing,
structured request logging to Cloud Logging, health checks, and webhook
delivery monitoring.

#### Why It Exists
Sentry's free tier is bound by **error rate**, not order volume — one broken
route or crawler loop burns 5,000 events in an afternoon. So this phase is
as much about controlling noise as capturing signal.

#### Prerequisites
Phases 1, 7, 9.

#### Scope
Sentry with `beforeSend` scrubbing and aggressive fingerprinting; structured
JSON logging with request IDs; `/api/health` that touches Postgres; webhook
delivery monitoring; spike protection.

#### Explicitly Out of Scope
APM tracing. Custom metrics backends. Log-based alerting beyond the defined
set.

#### Implementation Tasks
1. `@sentry/nextjs` with server, client and edge configuration. Source maps uploaded at build time and **not** served publicly.
2. **`beforeSend` PII scrubbing** — a strict allowlist, not a denylist. Strip addresses, phone numbers, email addresses, card and UPI data, cookies, auth headers and any request body from checkout or auth routes. A denylist will eventually miss a field; an allowlist fails safe.
3. Enable **spike protection**; set aggressive fingerprinting so one broken route produces one issue rather than thousands.
4. Structured JSON logger writing to stdout (Cloud Run ingests it into Cloud Logging). Every log line carries a `requestId`, route, method, status, duration, and identity type — **never the identity itself.**
5. Request-ID middleware: generate or propagate, attach to every log and every error response, surface to the user on error pages so a support conversation can start with a traceable ID.
6. `GET /api/health` performing a trivial indexed Postgres query. **The keep-warm ping must touch Postgres**, not just Cloud Run — otherwise a quiet week triggers Supabase's 7-day inactivity pause. This is a specific PDF rule and a real outage vector.
7. `GET /api/health/deep` — checks Razorpay, Brevo and R2 reachability. Used by smoke tests and on-call, not by the scheduler.
8. Webhook monitoring: alert when a `webhook_events` row stays unprocessed beyond a threshold, or when no Razorpay webhook has arrived during a period with active orders. **Silence is a failure mode here** — no webhooks does not mean no problems.
9. Log-based alerts: error rate spike, 5xx rate, checkout failure rate, reservation denial rate, Brevo daily count over 200, Supabase egress over 3 GB.
10. **Weekly Cloud Logging export to R2** — DPDP Rules impose a one-year minimum on personal data, traffic data and processing logs; Cloud Logging's default retention is 30 days.

#### Files / Areas Affected
`vokr/sentry.*.config.ts` · `vokr/src/lib/logger.ts` · `vokr/src/middleware.ts` · `vokr/src/app/api/health/**` · `vokr/src/instrumentation.ts`

#### Database Impact
None. **Logs never go to Postgres.**

#### API Impact
`GET /api/health`, `GET /api/health/deep`.

#### UI Impact
Error pages show a request ID.

#### Security Requirements
- **PII scrubbing is verified by test, not by inspection.** Deliberately throw an error inside a checkout handler holding a full address and assert the captured event contains none of it.
- Source maps are uploaded to Sentry and not publicly served.
- `SENTRY_AUTH_TOKEN` is a build-time secret, never in the runtime image.
- Health endpoints reveal no version, dependency or configuration detail.

#### Testing Requirements
- Unit: `beforeSend` strips every PII field across a representative fixture.
- Unit: the logger never serialises a full address, phone or email.
- Integration: health check fails when Postgres is unreachable.
- Integration: request IDs propagate through logs and error responses.
- **Security: an induced error in a checkout route produces a Sentry event with zero PII.**

#### Validation
Trigger a real error in staging with a full cart and address; inspect the
Sentry event field by field. Confirm the weekly export lands in R2.

#### Acceptance Criteria
- Errors reach Sentry with no PII.
- Every request is logged with a correlatable ID.
- The health check touches Postgres.
- Webhook silence is alertable.
- Weekly log export to R2 is running.

#### Production Checklist Mapping
**R22** (log retention half), and the PDF §8 items on structured logging and
uptime checks.

#### Dependencies
Sentry account, R2 bucket, Cloud Logging.

#### Exit Criteria
An induced production error is diagnosable from the request ID alone, and
the event contains no customer PII.

---

### PHASE 16 — Security + Abuse Protection

#### Status
**NOT STARTED**

#### Objective
Complete the application-layer security posture and configure Cloudflare's
WAF, bot protection and rate limiting.

#### Why It Exists
The checkout and auth surfaces are now real and therefore worth attacking.
Cloudflare Free allows **5 custom WAF rules**, so the rule set must be
chosen deliberately rather than accumulated.

#### Prerequisites
Phases 3, 5, 7, 9, 12. Cloudflare managing DNS for `vokr.shop`.

#### Scope
Security headers including HSTS; CSP; CSRF; centralised input validation;
an authorisation audit; the rate-limit matrix; 5 WAF rules; bot protection;
dependency scanning.

#### Explicitly Out of Scope
Penetration testing by a third party (recommended post-launch). A bug bounty.
Anything that adds complexity without a named threat.

#### Implementation Tasks
1. Security headers via middleware: `Strict-Transport-Security` with `max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`.
2. **Content Security Policy** with nonces. Razorpay's checkout script and Google OAuth require explicit allowances — deploy in `Report-Only` first, collect violations, then enforce.
3. CSRF: `SameSite=Lax` cookies plus origin verification on every state-changing request. **The Razorpay webhook is explicitly exempt** — it is authenticated by signature and must not be subject to origin checks.
4. Audit every route: authentication required, authorisation checked, ownership verified. Produce a route-by-route table. **A missing authorisation check is invisible until someone finds it.**
5. `zod` validation at every API boundary with `.strict()` — unknown fields are rejected, not silently dropped.
6. The rate-limit matrix, application layer:

   | Endpoint | Limit | Rationale |
   |---|---|---|
   | Sign-in / sign-up | 5 / 15 min / IP + 10 / hr / email | Credential stuffing |
   | Password reset | 3 / hr / email | Enumeration and mail-bombing |
   | **Guest order lookup** | **5 / 15 min / IP + 10 / day / order number, with lockout** | **Unauthenticated by design; the highest-risk endpoint** |
   | Return request | 5 / hr / IP | Same surface |
   | Checkout session create | 10 / hr / identity | Denial of inventory |
   | Reservation | 20 / hr / identity | Denial of inventory |
   | Cart mutation | 60 / min / identity | Abuse |
   | Serviceability | 30 / min / IP | Scraping |
   | Search index | Edge-cached | Cheap by construction |

7. The 5 Cloudflare WAF custom rules, chosen deliberately:
   1. Block or challenge non-India traffic to `/api/checkout/*` and `/api/payments/*` (Vokr ships only within India).
   2. Restrict `/admin/*` and `/api/admin/*` to known IPs or a Cloudflare Access policy.
   3. Rate-limit `/api/orders/lookup` and `/api/returns/*` at the edge, ahead of the application.
   4. Challenge requests with missing or suspicious user agents on all `POST /api/*`.
   5. Block known bad ASNs and scanner signatures on `/api/*`.
8. Enable Bot Fight Mode and managed challenges on the auth and lookup paths.
9. Dependency scanning in CI: `npm audit` at a defined severity plus Dependabot. A high-severity advisory fails the build.
10. **Bundle secret test**: build, then grep every client chunk for each server-only variable name and known secret prefixes. Fail the build on any hit.

#### Files / Areas Affected
`vokr/src/middleware.ts` · `vokr/src/server/security/*` · `vokr/src/server/rate-limit/*` · `vokr/docs/security/waf-rules.md` · `.github/workflows/`

#### Database Impact
None beyond `rate_limit_counters` from Phase 3.

#### API Impact
Headers and limits on everything. No new routes.

#### UI Impact
Rate-limit and challenge states handled gracefully rather than as raw errors.

#### Security Requirements
This phase *is* the security requirement. See §8 for the full checklist.

#### Testing Requirements
- Security: every header present on every response.
- Security: CSP blocks inline script while Razorpay checkout still functions.
- Security: cross-origin state-changing requests rejected; the webhook still accepted.
- Security: every rate limit triggers at its threshold and recovers.
- Security: the full authorisation matrix — for each protected route, an unauthenticated, a wrong-user and a correct-user request.
- Security: no server secret in any client bundle.
- Security: enumeration resistance re-verified on order and return lookup.

#### Validation
Run the automated security suite. Manually verify the WAF rules from outside
Cloudflare. Confirm HSTS in a browser. Run `/security-review` over the diff.

#### Acceptance Criteria
- HSTS, CSP and all security headers live.
- Every endpoint in the matrix rate limited at both layers.
- 5 WAF rules deployed and verified.
- Zero secrets in client bundles.
- Authorisation verified route by route.

#### Production Checklist Mapping
**R19** (HTTPS + HSTS, rate limiting, WAF enabled).

#### Dependencies
Cloudflare managing DNS.

#### Exit Criteria
The route-by-route authorisation table is complete with a passing test per
row, and the WAF rules are verified from the public internet.

---

### PHASE 17 — DPDP / Privacy / Data Lifecycle

#### Status
**NOT STARTED**

#### Objective
Build the consent architecture, data export and erasure endpoints, retention
enforcement and PII encryption that India's DPDP framework requires.

#### Why It Exists
`privacy-policy.html` already references DPDPA 2023. Substantive obligations
become enforceable **13 May 2027**; the PDF's instruction is to build the
consent architecture now and finish the rest before then. Retrofitting
consent onto live customer data is materially harder than building it in.

#### Prerequisites
Phases 3, 9, 15.

#### Scope
`consent_records`, `data_subject_requests`; consent capture; export;
erasure with financial-record retention; retention jobs; PII encryption at
rest; the grievance path; a data inventory.

#### Explicitly Out of Scope
Full DPDP certification. Cross-border transfer assessments. **Kids Model 123
as a child-account product** — it launches as an adult-purchased gift with no
child data collected, which is what the PDF permits.

#### Implementation Tasks
1. `consent_records` and `data_subject_requests` migrations. **Consent is append-only**: withdrawal is a new row, never an update, so the history is provable.
2. Consent capture at every collection point — account creation, checkout, newsletter, cookies. Each records purpose, policy version, timestamp, source and a hashed IP. **Purpose-specific, never a single blanket flag.**
3. Cookie consent for anything beyond strictly necessary. Analytics must not run before consent.
4. `POST /api/privacy/export` — authenticated (or verified for guests), producing a machine-readable archive of everything held about the subject: profile, addresses, orders, carts, consents, email log. Delivered via a signed, expiring link.
5. `POST /api/privacy/delete` — erasure that **anonymises PII in place while retaining the financial record**, because Indian tax law requires order retention. Name, email, phone and address are replaced with tombstones; the order, its totals and its invoice survive. Document this conflict explicitly in the privacy policy — it is a real tension and pretending otherwise is worse than explaining it.
6. Both flows are identity-verified and rate limited. **An erasure endpoint that can be triggered by an attacker is a denial-of-service weapon.**
7. **PII encryption at rest** for addresses and phone numbers, using a key from Secret Manager. Encrypt at the application layer so a database dump is not a PII leak — which matters directly because Phase 18 ships dumps to R2.
8. Retention jobs (Cloud Scheduler job 3) implementing every row of §3.5's retention table.
9. Data inventory document: every field of personal data, where it is stored, why, how long, who can see it, and where it is exported.
10. Grievance officer path: `grievance@vokr.shop` routed to a real inbox, a response SLA, and a tracked queue. This is statutory, not optional.
11. Privacy policy updated to match what the system actually does. **The policy describes the implementation, not the other way round.**

#### Files / Areas Affected
`vokr/src/server/privacy/*` · `vokr/src/server/crypto/*` · `vokr/src/app/api/privacy/**` · `vokr/src/app/(legal)/privacy-policy/**` · `vokr/docs/privacy/data-inventory.md`

#### Database Impact
Adds `consent_records`, `data_subject_requests`. Converts address and phone
columns to encrypted storage — a data migration requiring care and a tested
rollback.

#### API Impact
`POST /api/privacy/consent` · `POST /api/privacy/export` ·
`POST /api/privacy/delete` · `GET /api/privacy/requests/[id]`.

#### UI Impact
Consent UI at collection points; a cookie banner; a privacy centre for
export and deletion.

#### Security Requirements
- Export and deletion are identity-verified, rate limited and audit-logged.
- Export archives are delivered via short-lived signed URLs and deleted after collection.
- Encryption keys live in Secret Manager, are loaded at boot, and are never logged.
- Erasure is irreversible and requires explicit confirmation.

#### Testing Requirements
- Integration: consent recorded with purpose and version; withdrawal creates a new row and does not mutate the old one.
- Integration: export contains every category in the data inventory — a test enumerates the inventory and asserts coverage, so adding a PII field without adding it to export fails.
- Integration: erasure removes PII while the order and invoice remain valid.
- Integration: encryption round-trips; a raw database read shows ciphertext.
- Integration: retention jobs delete exactly what they should and nothing else.
- Security: an unverified erasure request is rejected.

#### Validation
Create a test customer, place an order, export the data, verify completeness
against the inventory, delete, then verify the order still reconciles
financially while carrying no PII.

#### Acceptance Criteria
- Consent captured per purpose, append-only.
- Export and erasure work and are verified.
- Addresses and phones encrypted at rest.
- Retention enforced automatically.
- The privacy policy matches the implementation.

#### Production Checklist Mapping
**R22** (DPDP consent capture + log retention).

#### Dependencies
Zoho Mail for `grievance@`. Legal review of the policy.

#### Exit Criteria
A full export-and-erasure cycle completes correctly on a real test account,
and a raw database dump contains no plaintext address or phone number.

---

### PHASE 18 — Backups + Restore

#### Status
**NOT STARTED**

#### Objective
Six-hourly `pg_dump` to R2 with retention, **and a restore that has actually
been performed.**

#### Why It Exists
Supabase Free has **no backups and no PITR**. The failure mode is total data
loss on corruption. The PDF is unambiguous: an untested backup is not a
backup.

#### Prerequisites
Phases 2, 14 (backup bucket), 17 (so dumps contain encrypted PII).

#### Scope
The dump job; R2 upload with retention; integrity verification; the restore
procedure; a real restore drill; the documented recovery runbook.

#### Explicitly Out of Scope
PITR (not available on Free). Cross-region replication. Automated failover.

#### Implementation Tasks
1. `POST /api/jobs/backup`, OIDC-authenticated, triggered by Cloud Scheduler job 2 every 6 hours. **RPO = 6 hours** — state that plainly in the runbook so nobody assumes better.
2. `pg_dump` in custom format, compressed, streamed to R2 without buffering the whole dump in a 512 MiB container.
3. Naming `vokr-YYYYMMDD-HHMMSS.dump` with a checksum sidecar.
4. Verify after upload: re-read, checksum, and record size. **An unverified upload is not a backup either.** Alert if size deviates sharply from the trailing average — a sudden shrink is how silent corruption announces itself.
5. Retention: 6-hourly for 7 days, daily for 30, weekly for 90. Implemented as an R2 lifecycle rule plus a pruning step.
6. `scripts/restore.ts` restoring a named dump into a target database, with a mandatory confirmation and a hard refusal to target production.
7. **The restore drill, performed for real**: take a production dump, restore it into a scratch database, run the full integration suite against it, and verify row counts and referential integrity. Record the elapsed time — that is the RTO, and it must be a measured number.
8. Recovery runbook: how to detect data loss, choose a dump, restore, re-point the application, verify, and communicate.
9. **Schedule quarterly restore drills** in the operational calendar. "Scheduled, not aspirational" is the PDF's phrasing.
10. Alert if no successful backup has completed in 8 hours.

#### Files / Areas Affected
`vokr/src/app/api/jobs/backup/route.ts` · `vokr/scripts/restore.ts` · `vokr/docs/runbooks/disaster-recovery.md`

#### Database Impact
Read-only. Dumps of everything.

#### API Impact
`POST /api/jobs/backup` (scheduler only).

#### UI Impact
None. Backup status visible in admin.

#### Security Requirements
- The backup bucket is **private**, with no public access under any circumstance.
- Dumps contain PII (encrypted at the column level after Phase 17, but the schema and volumes are still sensitive). R2 credentials are server-only and scoped to the backup bucket.
- The restore script refuses to target production.
- Backup completion is logged; dump contents are never logged.

#### Testing Requirements
- Integration: the job produces a valid dump and uploads it.
- Integration: checksum verification catches a corrupted upload.
- Integration: retention prunes correctly and never deletes the newest.
- **Manual, mandatory: a full restore drill with the integration suite passing against the restored database.**
- Alerting: a suppressed backup triggers the 8-hour alert.

#### Validation
Perform the restore drill. Record the RTO. Confirm the restored database
passes the same tests as production.

#### Acceptance Criteria
- Backups every 6 hours, verified, in R2.
- Retention enforced.
- **A restore has actually been performed and the RTO recorded.**
- The recovery runbook exists and has been followed by someone who did not write it.

#### Production Checklist Mapping
**R17** (backups with a tested restore).

#### Dependencies
R2 backup bucket, Cloud Scheduler slot 2.

#### Exit Criteria
A restored database has passed the integration suite, with the drill logged
in §0.2 including its date and measured RTO.

---

### PHASE 19 — CI/CD + Artifact Registry

#### Status
**NOT STARTED**

#### Objective
GitHub → GitHub Actions → Artifact Registry → Cloud Run, with environment
separation, a registry cleanup policy from the first push, and Secret
Manager holding exactly six secrets.

#### Why It Exists
**R1**: a payments system deployed by hand is not operable. **R2**: 0.5 GB
is the tightest quota in the stack and must be controlled from the first
image, not after it fills.

#### Prerequisites
Phases 1, 16. GCP project with billing enabled.

#### Scope
Dockerfile; the CI pipeline; Artifact Registry with a cleanup policy;
Workload Identity Federation; Secret Manager with the six-version
constraint; staging and production separation; migration strategy;
deployment smoke tests; rollback.

#### Explicitly Out of Scope
The Cloud Run service configuration and Cloudflare (Phase 20). Load testing
(Phase 21).

#### Implementation Tasks
1. Multi-stage `Dockerfile`: deps → build → runtime on `node:22-alpine` (matching `.nvmrc` and `engines`), copying only `.next/standalone`, `.next/static` and `public`. Non-root user. **Target under 150 MB.**
2. `.dockerignore` excluding `node_modules`, `.next`, `.git`, tests and every reference artefact.
3. CI on pull request: `npm run verify` plus the security suite, the bundle-secret test and the homepage weight check. Nothing merges red.
4. CI on merge to `master`: build, push to Artifact Registry tagged with the commit SHA, deploy to **staging**, run smoke tests.
5. Production deploy is a **manual approval gate** on a tagged release. Money paths do not auto-deploy.
6. **Artifact Registry cleanup policy in the same commit that creates the repository (R2)**: keep 2 tagged versions, delete untagged after 1 day. Alert at 400 MB of 500 MB.
7. **Workload Identity Federation** between GitHub Actions and GCP — no long-lived service-account JSON key in GitHub secrets.
8. **Secret Manager, exactly 6 active versions (R3)**: DB URL, Razorpay key ID, Razorpay key secret, Razorpay webhook secret, Brevo API key, Supabase service-role key. Loaded **once at process boot** — 10,000 access operations/month is about 13/hour, so a per-request fetch breaches it. Rotation **disables** the old version rather than adding a seventh; automate the check.
9. **Environment separation (R5)**: separate Supabase projects, separate R2 prefixes, separate Cloudflare hostnames, and **Razorpay sandbox credentials in staging, live only in production.** `env.ts` refuses to boot if a live Razorpay key is seen outside production.
10. **Close the §2.5 trap**: `NEXT_PUBLIC_SITE_URL` is supplied at image build time per environment, and the build **fails** if it is missing or still localhost. This is the gate that prevents shipping localhost canonical URLs.
11. Migration strategy: `prisma migrate deploy` as a pre-deploy step using `DIRECT_URL`, with expand/contract discipline so a rollback of application code never faces a schema it cannot read.
12. Smoke tests after every deploy: health check, homepage, a PDP, the catalog API, and a webhook signature rejection. Failure triggers automatic rollback.
13. Rollback: redeploy the previous Cloud Run revision by tag, documented and **practised at least once**.

#### Files / Areas Affected
`vokr/Dockerfile` · `vokr/.dockerignore` · `.github/workflows/ci.yml` · `.github/workflows/deploy.yml` · `vokr/scripts/smoke-test.ts` · `vokr/src/lib/env.ts`

#### Database Impact
Migrations run in the pipeline against staging then production.

#### API Impact
None new.

#### UI Impact
None.

#### Security Requirements
- No long-lived cloud credentials in GitHub. WIF only.
- Secrets never appear in build logs — CI masks them and a log scan asserts it.
- The runtime image contains no build secret and no `SENTRY_AUTH_TOKEN`.
- The image runs as non-root.
- Staging must be incapable of taking real money: a boot-time assertion rejects live Razorpay credentials outside production.

#### Testing Requirements
- CI: the full `verify` suite on every PR.
- CI: the image builds and starts, and `/api/health` responds.
- CI: no secret in any client bundle.
- CI: homepage weight budget.
- Integration: `migrate deploy` applies cleanly to a fresh database and to a copy of production.
- Manual: a rollback performed and timed.

#### Validation
Push a change; watch it reach staging automatically. Approve a production
release. Roll it back. Confirm the registry holds at most two tags.

#### Acceptance Criteria
- Every merge builds, tests and deploys to staging automatically.
- Production requires approval.
- Registry cleanup policy active.
- Exactly 6 Secret Manager versions, loaded at boot.
- Staging cannot use live Razorpay credentials.
- Rollback practised.

#### Production Checklist Mapping
**R1** (git + CI/CD), **R2** (registry cleanup), **R3** (Secret Manager, 6
versions, boot loading), **R5** (environment separation). Closes the §2.5
`NEXT_PUBLIC_SITE_URL` trap.

#### Dependencies
GCP project with billing. GitHub repository settings.

#### Exit Criteria
A change reaches production only through the pipeline, and a rollback has
been performed for real.

---

### PHASE 20 — Cloud Run + Cloudflare Production Deployment

#### Status
**NOT STARTED**

#### Objective
The production runtime: Cloud Run in Mumbai with the exact configuration the
PDF specifies, Cloudflare in front, the domain live, and billing guardrails
active.

#### Why It Exists
**R4** exists because GCP's free tier is a spending-based *discount, not a
ceiling*. An unbounded instance count under a crawl loop is how free-tier
accounts generate four-figure bills.

#### Prerequisites
Phase 19. Domain `vokr.shop` registered. Cloudflare account.

#### Scope
Cloud Run service configuration; Cloud Scheduler's three jobs; Cloudflare
DNS, SSL, caching, WAF; the domain; **billing budget alerts**; the
keep-warm ping that touches Postgres.

#### Explicitly Out of Scope
Load testing (Phase 21). `min-instances` (deliberately 0 — §10 trigger).

#### Implementation Tasks
1. Cloud Run service in **`asia-south1`**: `min-instances=0`, **`max-instances=3`**, 1 vCPU, 512 MiB, concurrency 80, request timeout tuned to the checkout path.
2. **`max-instances` is set at creation, not later.** Verified by an infrastructure assertion in the deploy pipeline.
3. **Billing budget alerts at $1 / $5 / $20 (R4)** on the billing account, routed to an inbox somebody actually reads.
4. The three Cloud Scheduler jobs — all three slots, per billing account, not per project:
   1. Keep-warm every 5 minutes hitting `/api/health`, **which touches Postgres**, preventing both Cloud Run cold starts and Supabase's 7-day inactivity pause.
   2. `pg_dump` to R2 every 6 hours (Phase 18).
   3. Maintenance: reservation expiry and row pruning (Phase 8).
   Each authenticated by OIDC with a dedicated service account.
5. Cloudflare: nameserver delegation, DNS records, full-strict SSL, HSTS with preload.
6. Cache rules — aggressive on static assets and marketing pages, **bypass on `/api/*`, `/checkout/*`, `/admin/*` and anything identity-bearing.** A cached checkout page is a data leak.
7. Deploy the Phase 16 WAF rules and enable bot protection.
8. Zoho Mail DNS for the five `@vokr.shop` mailboxes; verify each receives, especially `grievance@`.
9. Brevo sending DNS (SPF, DKIM, DMARC) verified on the same domain.
10. Cloud Run domain mapping through Cloudflare; confirm the origin is not reachable directly, so the WAF cannot be bypassed.
11. Confirm the Cloud Run free tier applies — it is not region-restricted and `asia-south1` is a Tier 1 region — while noting that **Mumbai has zero free egress**, which is why Cloudflare caching and R2 images matter.

#### Files / Areas Affected
`.github/workflows/deploy.yml` · `vokr/docs/infrastructure/cloud-run.md` · `vokr/docs/infrastructure/cloudflare.md` · Cloud Scheduler job definitions

#### Database Impact
Production Supabase becomes live and is reached only from Cloud Run.

#### API Impact
Job endpoints become reachable by the scheduler's service account only.

#### UI Impact
The site is live at `vokr.shop`.

#### Security Requirements
- Cloud Run allows unauthenticated access only to public routes; job endpoints require OIDC.
- The origin is not directly reachable — all traffic passes Cloudflare.
- HSTS with preload.
- The service account follows least privilege; no default compute account.
- Budget alerts verified by lowering a threshold until one actually fires. **An untested alert is not an alert.**

#### Testing Requirements
- Smoke tests against production after deploy.
- Verify `max-instances=3` via the API, not the console.
- Verify all three scheduler jobs execute successfully.
- Verify the keep-warm ping reaches Postgres, by observing the query.
- Verify cache rules never cache an identity-bearing response — a test asserts `Cache-Control: private, no-store` on those routes.
- Verify each of the five mailboxes receives mail.
- Verify SSL, HSTS and the WAF rules from outside.

#### Validation
Full production smoke test. Confirm a budget alert fires. Confirm the origin
rejects direct traffic.

#### Acceptance Criteria
- Cloud Run runs the exact PDF configuration.
- `max-instances=3` and budget alerts verified live.
- All three scheduler jobs green.
- Cloudflare serving with SSL, HSTS, WAF and correct caching.
- All five mailboxes receive.

#### Production Checklist Mapping
**R4** (`max-instances` + budget alerts), **R19** (HTTPS/HSTS/WAF —
infrastructure half).

#### Dependencies
Domain, Cloudflare, GCP billing, Zoho, Brevo DNS.

#### Exit Criteria
The site is live, guardrailed, and a budget alert has been observed firing.

---

### PHASE 21 — Performance + Load Testing

#### Status
**NOT STARTED**

#### Objective
Run the concurrent-checkout load test the PDF names as *"the single most
valuable pre-launch test"*, plus a general performance pass.

#### Why It Exists
**R10** is, in the PDF's words, "the one number in this document that cannot
be estimated, and the one that decides whether Vokr oversells on its first
busy day". Concurrent checkout capacity is bound by row-lock contention on a
hot variant, not by throughput, and no amount of reasoning substitutes for
measuring it.

#### Prerequisites
Phases 8, 9, 20. Staging mirroring production configuration.

#### Scope
The 10/25/50 concurrent-buyer checkout test on a single variant; browse-path
load testing; Core Web Vitals; database query performance; cold-start
measurement; Supabase egress under load.

#### Explicitly Out of Scope
Stress testing to destruction. Chaos engineering. Anything at a scale the
free tier is not intended to serve.

#### Implementation Tasks
1. Build the k6 (or Artillery) scenario: N virtual users simultaneously attempting to purchase **the same variant**, through the real path — cart → checkout session → pricing → reservation → Razorpay test order → webhook.
2. Seed the variant with a **known, small** stock quantity so overselling would be unambiguous.
3. Run at **10, 25 and 50** concurrent buyers, three runs each for stability.
4. **What is measured, per run:**

   | Metric | How | Pass criteria |
   |---|---|---|
   | Overselling | Final `quantity_on_hand` vs. reservations committed | **`quantity_on_hand >= 0` always; committed reservations ≤ seeded stock. Any oversell is an outright failure.** |
   | Duplicate orders | Orders grouped by `checkout_session_id` and by `idempotency_key` | Exactly one order per successful session; zero duplicates |
   | Payment/order consistency | Every captured payment has one order; every prepaid order has one captured payment | Zero orphans on either side |
   | Successful checkouts | Count of orders created | Exactly `min(N, stock)` |
   | Clean denials | Failed attempts returning a correct sold-out response | `N - stock`, all with a proper message and no 5xx |
   | Error rate | 5xx over total | **0%.** A sold-out response is a 409, not a 500 |
   | Deadlocks | Postgres deadlock counter | **Zero.** A non-zero count means the deterministic lock order is broken |
   | Lock wait time | `pg_stat_activity` sampling | Recorded; sharp growth from 25→50 is the contention signal |
   | p50 / p95 / p99 latency | k6 | Recorded per stage; p95 checkout under 3 s |
   | Inventory integrity | `quantity_on_hand - quantity_reserved >= 0` throughout | Never violated |
   | Reservation leaks | Held reservations after the run and after expiry | Zero after expiry |

5. **Run the test with the Razorpay call deliberately slowed** (an injected delay) to prove it is outside the lock. If lock wait time tracks the injected delay, R9 is violated and the phase fails.
6. Browse-path load test at the §5.2 traffic profile; measure Cloud Run vCPU-seconds and Supabase egress per pageview against the free-tier model.
7. Cold-start measurement with the keep-warm ping disabled, then enabled. This is the evidence that decides whether `min-instances=1` is ever needed (§10).
8. Core Web Vitals on homepage, PDP, cart and checkout, mobile profile.
9. `EXPLAIN ANALYZE` every hot query; eliminate sequential scans.
10. **Record every number in this document.** The PDF's estimates become measurements, and the §10 upgrade triggers become concrete.

#### Files / Areas Affected
`vokr/load-tests/checkout-concurrency.js` · `vokr/load-tests/browse.js` · `vokr/docs/performance/results.md`

#### Database Impact
None permanent. Staging data is reset between runs.

#### API Impact
None.

#### UI Impact
Fixes arising from the Web Vitals pass.

#### Security Requirements
- Load tests run against **staging with Razorpay sandbox credentials only**. A test that could hit live Razorpay is a defect in the test.
- Test data is synthetic; no real customer PII.

#### Testing Requirements
This phase is the test. **R10 is not satisfied by an estimate, a code
review, or a 10-user run alone — all three concurrency levels must be
executed and their results recorded.**

#### Validation
Three runs at each level. Consistent results. Zero overselling, zero
duplicate orders, zero deadlocks, zero 5xx.

#### Acceptance Criteria
- 10, 25 and 50 concurrent buyers on one variant, all executed.
- Zero overselling at every level.
- Zero duplicate orders.
- Payment and order records reconcile exactly.
- Deadlock count zero.
- Razorpay latency proven not to extend lock hold time.
- All numbers recorded in `docs/performance/results.md` and §0.2.

#### Production Checklist Mapping
**R10** (concurrent checkout load test) — the whole of it.

#### Dependencies
Staging environment matching production.

#### Exit Criteria
The measured safe concurrent-checkout number is written down, and it is a
measurement rather than an estimate.

---

### PHASE 22 — Production Hardening

#### Status
**NOT STARTED**

#### Objective
Close everything found in Phases 15–21, verify every alert fires, and prove
the operational processes work under someone other than their author.

#### Why It Exists
The gap between "built" and "operable" is where launches fail. Alerts that
have never fired, runbooks nobody has followed, and dashboards nobody has
opened are all forms of pretending.

#### Prerequisites
Phases 15–21.

#### Scope
Alert verification; runbook rehearsal; failure-mode drills; dependency
update; a final security review; content and legal consistency; the launch
plan.

#### Explicitly Out of Scope
New features of any kind.

#### Implementation Tasks
1. **Fire every alert deliberately** — error spike, 5xx rate, checkout failure, Brevo 200/day, Supabase 3 GB egress, backup failure, webhook silence, budget threshold. An alert that has never fired is a hypothesis.
2. Rehearse every runbook with someone who did not write it: fulfilment, disaster recovery, incident response, rollback.
3. Failure drills in staging: Supabase unreachable; Razorpay timing out; Brevo returning 429; R2 unreachable; a webhook storm. **Verify each degrades honestly rather than corrupting state.** Specifically: a Brevo outage must not lose orders, and a Supabase outage must not take money without recording it.
4. Update dependencies; re-run the full suite; re-run `npm audit`.
5. Full security review over the accumulated diff (`/security-review`), plus a manual pass on the authorisation matrix.
6. **Content and legal consistency audit**: read `terms`, `privacy-policy`, returns, shipping and FAQ against what the system actually does. Every promise is either implemented or the copy is amended. This closes R14 properly and catches drift introduced across nineteen phases.
7. **Final fabricated-content sweep**: grep the built output for "4,059", "4.7", the invented reviewer names, and any unverifiable claim. Automated, so it cannot regress.
8. Verify the six Secret Manager versions are exactly six, and rotate one end-to-end to prove the disable-not-add procedure works.
9. Verify Artifact Registry is under quota and the cleanup policy has actually deleted something.
10. Pre-authorise the Supabase Pro upgrade so on-call can act the moment egress alerts fire — the PDF calls this a "standing decision to make now, not later". A 402 during a festival sale costs more than three years of Supabase Pro.
11. Write the launch-day plan: who watches what, what the rollback trigger is, and who decides.

#### Files / Areas Affected
`vokr/docs/runbooks/**` · `vokr/docs/launch-plan.md` · dependency manifests

#### Database Impact
None.

#### API Impact
None.

#### UI Impact
Copy corrections from the consistency audit.

#### Security Requirements
Full review; every finding triaged and either fixed or explicitly accepted
with a reason and an owner.

#### Testing Requirements
- Every alert fired and observed.
- Every failure drill executed.
- Full regression suite green.
- Security review complete with no unaddressed high findings.

#### Validation
Someone other than the implementer follows each runbook end to end and
succeeds.

#### Acceptance Criteria
- Every alert verified live.
- Every runbook rehearsed by a second person.
- Legal copy matches the implementation.
- Zero fabricated content, enforced by an automated check.
- Secret rotation proven.

#### Production Checklist Mapping
Verification pass across **R4, R12, R14, R17, R19, R20, R22**.

#### Dependencies
Phases 15–21.

#### Exit Criteria
Nothing in the operational plan is untested.

---

### PHASE 23 — Final Launch Certification

#### Status
**NOT STARTED**

#### Objective
Walk §13's gate item by item, attach evidence to every R1–R22 requirement,
and make the launch decision explicitly.

#### Why It Exists
"Ready to build, not ready to launch" is the PDF's own framing. The 22
blocking items must all be **true and evidenced**, not believed.

#### Prerequisites
Phases 0–22.

#### Scope
Execution of the §13 gate; evidence collection; the go/no-go decision;
launch; post-launch watch.

#### Explicitly Out of Scope
Anything deferred in §10. Post-launch features.

#### Implementation Tasks
1. Work §13 line by line. For each, attach evidence: a commit, a test run, a screenshot, a dashboard, a provider confirmation, a drill log.
2. Complete the R1–R22 mapping table in §6 with a real evidence reference in every row.
3. **Razorpay live-mode KYC complete (R16)** and live credentials in production Secret Manager only.
4. Place a **real money order end to end**: real payment, real email, real Shiprocket entry, real tracking, real delivery. Then refund it. This is the only test that exercises every provider simultaneously.
5. Place a **real COD order** end to end.
6. Verify the final catalog: five SKUs (D1 — gift cards deferred), real stock quantities entered, real photography, correct prices, correct GST.
7. Go/no-go with every blocking item verified. **Any unverified blocking item is a no-go** — there is no partial credit on this list.
8. Launch: DNS cutover, monitor, watch the alerts.
9. Post-launch watch: first 24 hours, then the first week. Daily reconciliation of payments to orders.
10. Record the launch in §0.2 with the certifying commit.

#### Files / Areas Affected
This document. `vokr/docs/launch-certification.md`.

#### Database Impact
Production seeded with real stock.

#### API Impact
Live Razorpay credentials.

#### UI Impact
Live site.

#### Security Requirements
Final verification that live secrets exist only in production Secret
Manager, that staging cannot reach them, and that no live key has ever been
committed.

#### Testing Requirements
Full production smoke test. One real prepaid order and one real COD order,
each completed and reversed.

#### Validation
The §13 gate, fully evidenced.

#### Acceptance Criteria
- All 22 blocking requirements verified with evidence.
- A real prepaid order and a real COD order completed end to end.
- Go/no-go recorded with a named decision-maker.

#### Production Checklist Mapping
**All of R1–R22.**

#### Dependencies
Everything.

#### Exit Criteria
§13 fully checked with evidence, and the launch decision recorded.

---

## 6. Production Blockers — R1 to R22

Every blocking item from PDF §7. **The launch gate requires all 22 to be
actually verified.** "Status" is one of NOT STARTED / IN PROGRESS /
IMPLEMENTED / **VERIFIED**. Only VERIFIED counts, and only with evidence.

| # | Requirement | What must be implemented | Phase | How it is verified | Evidence required | Status |
|---|---|---|---|---|---|---|
| **R1** | Git repository with CI/CD | Repo exists (done); GitHub Actions → Artifact Registry → Cloud Run | 0, 19 | A change reaches production only through the pipeline | Successful pipeline run URL; deployed revision SHA | IN PROGRESS |
| **R2** | Artifact Registry cleanup policy | Keep 2 tags, delete untagged; set in the repository-creating commit. `output: "standalone"` keeps images small | 0, 19 | Policy queried via API; registry under quota after ≥ 5 deploys | Policy JSON; registry size screenshot; image size | IN PROGRESS |
| **R3** | Secrets in Secret Manager, loaded at boot | Exactly 6 versions: DB URL, Razorpay key ID, key secret, webhook secret, Brevo API key, Supabase service-role key | 19 | Version count = 6; a boot-time load with zero per-request fetches | Version listing; access-count metric; rotation drill log | NOT STARTED |
| **R4** | `max-instances=3` + billing budget alerts | Set at service creation; alerts at $1/$5/$20 | 20 | Service config via API; **an alert observed firing** | Service description; alert screenshot | NOT STARTED |
| **R5** | Environment separation | Dev/staging/prod; staging on Razorpay **sandbox** | 19 | Boot assertion rejects live keys outside production | Config listing; failing-boot test output | NOT STARTED |
| **R6** | Server-side price resolution | Prices resolve from variant ID server-side; no endpoint accepts a price | 2, 5, 6 | Automated test: posting a price changes nothing. **Client-controlled-pricing regression test** (generalized from the legacy gift-card defect; the gift-card SKU itself is deferred, D1) | Test run; the regression test | IN PROGRESS — structural half done (Phase 2: `resolvePrices()` is the only price-shaped export, unit-tested); behavioural half (no cart/checkout endpoint accepts a client price) lands in Phase 5 |
| **R7** | Razorpay webhook signature verification | Constant-time HMAC on the raw body; state driven only by webhooks | 7 | Tampered payload rejected; forged browser callback grants nothing | Security test output | NOT STARTED |
| **R8** | Idempotency keys | On checkout session, Razorpay order creation and all payment endpoints | 6, 7 | Repeated key produces one order; replayed webhook is inert | Integration test; concurrency run | NOT STARTED |
| **R9** | Inventory reservation in a DB transaction | `SELECT … FOR UPDATE` with `CHECK (quantity_available >= 0)`; **Razorpay outside the lock** | 2, 8 | Concurrency test; constraint proven to fire; injected-latency test shows lock time unaffected | Test output; architecture test; latency chart | NOT STARTED |
| **R10** | Load test concurrent checkout on one variant | **10 / 25 / 50** concurrent buyers of one variant | 21 | Executed at all three levels; zero oversell, zero duplicates, zero deadlocks, zero 5xx | k6 output for all three; results doc | NOT STARTED |
| **R11** | GST per variant + compliant invoice | Per-variant rate and HSN; sequential numbering; CGST/SGST vs IGST | 2, 6, 9 | Mixed-slab cart computed correctly; invoice reviewed by the CA | Test output; a CA-reviewed sample invoice | **BLOCKED on D2** |
| **R12** | Brevo as Supabase Auth custom SMTP | Configured **before any real signup**; rate limit raised | 3 | **A confirmation email delivered to an address outside the project team** | Screenshot of the received email with headers | NOT STARTED |
| **R13** | Raise Auth email rate limit; forward client IP | Limit raised; real client IP forwarded, or Auth called from the browser | 3 | Dashboard setting; a test showing per-IP not per-instance limiting | Screenshot; test output; ADR entry | NOT STARTED |
| **R14** | Amend terms: "email/SMS" → "email" | Copy change plus a full consistency audit | 4, 22 | Grep the built output for "SMS" in the confirmation context | Diff; content audit doc | NOT STARTED |
| **R15** | Courier operational | Shiprocket live, COD enabled, PIN serviceability available; manual panel acceptable | 6, 10 | A real order shipped and tracked through the panel | Account screenshot; a real AWB; runbook | NOT STARTED |
| **R16** | Razorpay live-mode KYC | Entity, PAN, GST, bank account | 7, 23 | Live mode active; a real payment captured | Dashboard status; a real transaction ID | **BLOCKED on D3** |
| **R17** | Backups with a tested restore | 6-hourly `pg_dump` to R2, retention, verification | 18 | **A real restore performed** with the integration suite passing against it | Drill log with date, elapsed RTO, test output | NOT STARTED |
| **R18** | Catalog cached in Cloud Run memory | In-process cache, short TTL, single-flight | 2, 13 | Concurrent-miss test issues one query; egress measured | Test output; measured bytes/pageview | IN PROGRESS — `TtlCache` implemented and unit-tested (60s TTL, single-flight verified by concurrent-miss test); not yet VERIFIED at the launch-gate level — that needs Cloud Run and real measured egress (Phase 13/20) |
| **R19** | HTTPS + HSTS; rate limiting; WAF | Headers; the full rate-limit matrix; 5 WAF rules; bot protection | 16, 20 | Headers verified externally; every limit triggers; WAF verified from the internet | Header scan; rate-limit test output; WAF config | NOT STARTED |
| **R20** | Remove fabricated reviews | Delete 10 reviews, the 4.7 average, the "4,059 customer reviews" meta | 4 | **Automated check: those strings appear nowhere in the build** | CI check output | NOT STARTED |
| **R21** | Homepage under 500 KB | All 84 images to R2 as WebP/AVIF with responsive sizes; zero base64 | 14 | Automated weight budget in CI; zero `cdn.shopify.com` matches | CI output; Lighthouse report | NOT STARTED |
| **R22** | DPDP consent + log retention | Consent records, export and deletion endpoints, weekly log export to R2 | 15, 17 | Full export-and-erasure cycle on a real test account; export job running | Cycle log; R2 listing | NOT STARTED |

**Current: 0 of 22 VERIFIED.** Two are blocked on human decisions (R11 on
D2, R16 on D3) and should be unblocked immediately because they gate late
phases and have long lead times.

---

## 7. Testing Strategy

### 7.1 Layers

| Layer | Tool | Scope | Where mandatory |
|---|---|---|---|
| Unit | Vitest (node) | Pricing, GST, rounding, state machines, signature verification, cache, validation | Every phase from 1 |
| Component | Vitest + Testing Library | PDP, cart, checkout, forms, search | Phases 4, 5, 6, 13 |
| Integration (DB) | Vitest + Compose Postgres | Prisma, constraints, transactions, migrations, seeds | Every phase with a schema change |
| API | Vitest + route handlers | Every endpoint's contract, validation, status codes | Every phase adding a route |
| Concurrency | Vitest with parallel clients | Reservations, idempotency, deadlocks | **Phase 8, mandatory** |
| Security | Vitest + targeted scripts | AuthZ matrix, enumeration, rate limits, bundle secrets, PII scrubbing | Phases 3, 5, 7, 9, 15, 16 |
| E2E | Playwright | Browse → cart → checkout → payment → order; guest lookup; auth | Phases 7, 9, 23 |
| Responsive / a11y | Playwright + axe | 360/768/1024/1440; zero serious violations | Phase 4, re-run each UI phase |
| Load | k6 | **10/25/50 concurrent buyers on one variant**; browse profile | **Phase 21, mandatory** |
| Smoke | Node script | Health, homepage, PDP, catalog API, webhook rejection | Every deploy |

### 7.2 Gates — where tests block progress

- **Before Phase 2:** a test runner exists and `npm run verify` passes.
- **Before Phase 6:** cart tests pass, including the client-controlled-pricing regression.
- **Before Phase 7:** the checkout state machine and pricing tests pass.
- **Before Phase 9:** webhook signature, replay and forged-callback tests pass.
- **Before Phase 10:** the Phase 8 concurrency suite passes deterministically.
- **Before Phase 20:** the full security suite passes.
- **Before Phase 23:** **R10 executed at all three levels**, and the R17 restore drill performed.

### 7.3 Rules

- A bug fix ships with a regression test that fails before the fix.
- The three tests that pin known legacy defects — client-controlled pricing (originally found via the gift-card page), search-index drift, fabricated content — **never get deleted.**
- Concurrency and security tests are never skipped to unblock a deploy.
- Coverage ratchets: the threshold rises with each phase and never falls.
- Tests use fixtures, never production data.

---

## 8. Security Strategy

Consolidated checklist. Every item traces to a named threat; nothing is here
for the sake of completeness.

**Authentication** — Supabase Auth, no custom crypto · password minimum
length with a breach check, no composition rules · Google OAuth with
verified redirect URIs · reset tokens single-use and short-lived ·
enumeration-resistant responses · rate limited.

**Sessions & cookies** — HttpOnly, Secure, SameSite=Lax · session
identifier rotated on every privilege change · guest tokens 256-bit random,
stored hashed · bounded lifetimes · short idle timeout for admin.

**CSRF** — SameSite plus origin verification on state-changing requests ·
**the Razorpay webhook is exempt and authenticated by signature instead.**

**Input validation** — `zod` `.strict()` at every boundary; unknown fields
rejected · size limits on every body · no request field ever influences a
price, tax or total.

**Authorization** — checked server-side on every request; never inferred
from a client route · ownership verified on every cart, checkout, order and
address read · a route-by-route matrix with a test per row · admin
protected at both the application and Cloudflare layers.

**Enumeration resistance** — guest order and return lookup: uniform
responses, constant-time comparison, uniform timing, per-IP and
per-order-number limits with lockout.

**Rate limiting** — the §16 matrix, at both the application and Cloudflare
layers. Postgres-backed, with mandatory pruning.

**WAF & bot protection** — 5 Cloudflare rules as specified · Bot Fight Mode
· managed challenges on auth and lookup.

**Payments** — signature verified on every webhook, constant-time, raw body
· replay-protected by unique event ID · **browser callback is untrusted
input** · idempotency keys on order and payment creation · amounts logged,
instrument details never.

**Inventory integrity** — reservation inside a transaction with `FOR UPDATE`
· `CHECK` constraints as the backstop · deterministic lock ordering ·
per-identity reservation caps against denial-of-inventory.

**Secrets** — Secret Manager, 6 versions, loaded at boot · never in code,
logs, error messages or client bundles · a build-time bundle scan · WIF
instead of long-lived cloud keys · rotation disables rather than adds.

**PII** — addresses and phones encrypted at rest · allowlist scrubbing
before Sentry · never in logs, URLs or metrics · admin PII reveals audit-
logged.

**Transport** — TLS everywhere · HSTS with preload · full-strict origin ·
origin unreachable except through Cloudflare.

**Dependencies** — `npm audit` in CI at a defined severity · Dependabot ·
lockfile committed · exact pins on `next`, `react`, `react-dom`.

**Environment isolation** — separate Supabase projects, R2 prefixes and
hostnames · staging on Razorpay sandbox, enforced at boot · production
secrets never reachable from staging.

---

## 9. Privacy / DPDP Strategy

**Legal position.** `privacy-policy.html` already invokes DPDPA 2023.
Substantive obligations become enforceable **13 May 2027**. The architecture
is built now; the remaining obligations are completed before that date.

**Consent** — purpose-specific, never blanket · captured at every collection
point with policy version, timestamp, source and hashed IP · **append-only**,
so withdrawal is a new row and history is provable · analytics do not run
before consent.

**Rights** — export produces a complete machine-readable archive delivered
by short-lived signed URL · erasure anonymises PII in place while retaining
the financial record for the 8-year tax obligation. **That conflict is real
and is stated plainly in the privacy policy rather than papered over.** Both
flows are identity-verified, rate limited and audit-logged.

**Retention** — the §3.5 table, enforced by Cloud Scheduler job 3 · Cloud
Logging exported weekly to R2 to satisfy the one-year minimum on personal
data, traffic data and processing logs, since default retention is 30 days.

**Minimisation** — collect only what an order needs · no phone until COD or
shipping requires it · rendered email bodies never persisted · no PII in
logs, URLs, metrics or Sentry.

**Encryption** — addresses and phone numbers encrypted at the application
layer, keys from Secret Manager. This is what makes shipping database dumps
to R2 acceptable.

**Children** — **Kids Model 123 launches as an adult-purchased gift only.**
No child account, no child profile, no child data. Anything more requires
verifiable parental consent and is deferred.

**Grievance** — `grievance@vokr.shop` on Zoho, monitored, with a response
SLA and a tracked queue. Statutory.

**Data inventory** — maintained in `docs/privacy/data-inventory.md`. A test
asserts the export covers every category listed, so adding a PII field
without adding it to export fails CI.

---

## 10. Upgrade Triggers

From PDF §10. The distinction that matters: **the first seven are billing
changes; the last is an architectural one.**

| Trigger | Action | Cost | Type |
|---|---|---|---|
| ~70 orders/day, or any single day above ~75 | Brevo Starter | $9/mo (~₹792) | **BILLING.** The first trigger you will hit. Removes the daily cap and Brevo branding. |
| Supabase egress crosses 3 GB, or ~250,000 pageviews/month | Supabase Pro | $25/mo (~₹2,200) | **BILLING.** Removes the 402 cliff, adds daily backups with 7-day retention, removes the inactivity pause. **Pre-authorise this now** (Phase 22) so on-call can act without a meeting. |
| A third person needs the error dashboard | Sentry Team | $26/mo (~₹2,288) | **BILLING.** Triggered by the 1-user cap, not error volume. |
| ~600+ orders/month | Shiprocket API plan | ~₹499/mo `UNVERIFIED` | **BILLING**, then a small **ARCHITECTURAL** change to automate what Phase 10 does manually. |
| SMS becomes worth it | DLT registration + MSG91 | ₹5,900 one-time + ~₹0.15–0.25/SMS | **ARCHITECTURAL.** Requires the R14 copy change to be reversed and a new integration. 3–7 days of approval before a single message delivers. |
| Cold starts measurably hurt conversion | `min-instances=1` | ~$4–10/mo | **BILLING.** Only after Phase 21 measurement. The keep-warm cron should make this unnecessary for a long time. |
| More than 5 WAF custom rules, or bot traffic affects revenue | Cloudflare Pro | $20–25/mo | **BILLING.** |
| ~300–500 orders/day | Background job runner | Engineering time | **ARCHITECTURAL — the first real one.** Move outbound email and courier calls off the request path. **Redis follows this, never before.** |

At 2,000 orders/month the combined upgrades run roughly ₹3,000/month —
about 0.15% of GMV. Infrastructure is not the cost problem at any point on
this path. **RTO on COD is** — at 20% RTO the effective added cost per
*delivered* COD order is around ₹62.50, which dwarfs the entire
infrastructure bill within a few dozen orders.

---

## 10A. Features Intentionally Deferred

Each was considered and consciously postponed. **None is an oversight.** Do
not implement one because it seems easy — implement it when its trigger
fires.

| Feature | Reason | Prerequisite | Trigger for reconsideration |
|---|---|---|---|
| **SMS / phone OTP** | TRAI's DLT framework requires Principal Entity registration at ~₹5,900 one-time plus 3–7 days of approval before a single message delivers. A poor first spend at low order volume. | R14 copy change already made (Phase 4) | Order volume makes ₹5,900 trivial, or SMS becomes a support requirement |
| **Redis / Upstash** | Postgres handles rate limiting (a table with an index), cart persistence and inventory locking (`SELECT … FOR UPDATE`). Upstash's free tier has **no uptime SLA** and rate-limits at the budget cap — making the last-pair-in-stock guarantee depend on it invites overselling. | Measurement showing Postgres is the bottleneck | **After** the background queue, never before |
| **Background queue / worker** | Three Cloud Scheduler jobs cover every scheduled need at this scale. Razorpay retries its own webhooks. | Phase 21 latency data | ~300–500 orders/day, when inline email and courier calls hurt checkout latency. **The first genuine architectural change.** |
| **Search engine / Postgres FTS** | Over-specified for 13 searchable entries. The real defect was duplication, fixed in Phase 13. | Catalog growth | ~50+ SKUs, or query complexity beyond substring matching |
| **Real reviews** | Must be gated on `order_item_id` so verified-purchase is enforced by a foreign key. Requires deleting the fabricated ones first. | R20 complete (Phase 4); real orders exist | After orders exist and there is something honest to show |
| **Review photo uploads** | Needs a moderation queue and R2 upload handling. | Real reviews | With real reviews |
| **Wishlist** | Currently `href="#"` placeholders. No revenue dependency. | — | Post-launch, on demand |
| **Saved addresses** | Order flow works without an address book; each order snapshots its address. | Phase 6 | Post-launch, when repeat-purchase rate justifies it |
| **Order history beyond basic list** | Phase 9 ships the list and detail; richer filtering and re-order are extra. | Phase 9 | Post-launch |
| **Gift cards** | Selling one creates a redeemable liability requiring the store-credit ledger, which is out of scope for launch. **Decision D1 (8 Sep 2026): deferred from launch entirely** — not displayed anywhere on the site, not purchasable, no redemption or ledger functionality. | Store-credit ledger | Reconsider post-launch only if commercially justified; requires a new D1-reversing decision |
| **Referral program** | The site promises ₹500 in Vokr credit; that needs the ledger. | Store-credit ledger | After the ledger |
| **Discount code engine** | Implied by the subscription and discount-program pages, but no launch dependency. | Phase 6 pricing | Post-launch, when marketing needs it |
| **Store credit / wallet ledger** | Append-only, double-entry, never a mutable balance column. | — | Needed by COD refunds to credit and by referrals (gift cards deferred indefinitely, D1) |
| **Subscriptions** | `subscription.html` promises a fresh pair every 3/6/12 months at 15% off. Recurring debits in India require Razorpay Subscriptions with e-Mandate / UPI AutoPay, separate onboarding, RBI additional-factor authentication and mandatory 24-hour pre-debit notification. **This is its own project, not a cron job.** | Everything else stable | Last. Treat as a separate programme. |
| **Kids Model 123 as a child-data product** | DPDP requires verifiable parental consent for under-18 data. | Parental consent architecture | Only if Vokr wants child accounts. Selling as an adult-purchased gift needs nothing. |
| **Multi-warehouse inventory** | One location at launch. | — | A second fulfilment location |
| **Shiprocket API integration** | Manual panel keeps fixed cost at zero and the plan tier unverified. | Phase 10 runbook | ~600+ orders/month, when manual pushing becomes untenable |

---

## 11. Architecture Decision Log

Decisions that should not be casually changed. Each records what would have
to be true for it to be revisited. **Adding a new ADR entry is the required
way to reverse one of these** — not a commit that quietly does it.

| # | Decision | Rationale | Revisit when |
|---|---|---|---|
| **ADR-001** | **One Next.js app** — pages and API routes in a single deployable | The legacy site duplicates ~80 KB of CSS/JS across 27 files, and the duplication has *already* caused a defect (13-vs-15 search index). One deployable removes the class of bug and eliminates CORS and cookie-domain problems between a static frontend and a separate API. | A module genuinely needs independent scaling. Not before. |
| **ADR-002** | **Supabase over Neon** | Two grounds. Region: Neon's only APAC regions are Singapore and Sydney; Supabase has Mumbai. Decisive: Neon Free caps at 100 compute-hours/month **as a hard cutoff that suspends the database**, and an always-warm instance burns roughly 180. Neon Free cannot run an always-on store. | Neon changes its free-tier model *and* adds a Mumbai region |
| **ADR-003** | **Supabase Auth over Clerk** | Architecture, not cost. Identity lives in Vokr's own Postgres, so `orders.user_id` is a real foreign key and DPDP erasure is one system rather than two. (Clerk is *not* expensive — it raised its free allotment to 50,000 monthly retained users on 5 Feb 2026. The reason is referential integrity.) | Referential integrity stops mattering, which is to say never |
| **ADR-004** | **Prisma** with a transaction-mode pooler (`pgbouncer=true`), plus a **direct/session connection for the checkout transaction** | Type-safe queries and migrations. The dual connection exists because `SELECT … FOR UPDATE` semantics under a transaction-mode pooler are a class of subtlety not worth carrying in the money path. | A measured Prisma limitation, not a preference |
| **ADR-005** | **R2 over GCS** for backups and images | GCS's free tier applies **only** in `us-east1`/`us-west1`/`us-central1`. R2 is free and has **zero egress at any volume**, which is also what keeps Cloud Run's Mumbai egress near zero. | GCP offers a comparable free allowance in `asia-south1` |
| **ADR-006** | **No Redis at launch** | Postgres covers rate limiting, cart persistence and inventory locking. Upstash's free tier has no uptime SLA and rate-limits at the budget cap; making the last-pair guarantee depend on it invites overselling. One fewer vendor, hop and free tier to breach. | Measurement shows Postgres is the bottleneck — **and only after the queue** |
| **ADR-007** | **No queue or worker at launch** | Three Cloud Scheduler jobs cover every scheduled need at this scale, and Razorpay retries its own webhooks. Cloud Tasks' 1M free operations remain available. | ~300–500 orders/day |
| **ADR-008** | **Static JSON search index** | 13 searchable entries. Postgres FTS solves a problem Vokr does not have; the real defect was 27-fold duplication and drift. | ~50+ SKUs |
| **ADR-009** | **Manual Shiprocket workflow at launch** | Keeps fixed cost at zero. API access may be gated behind a paid tier (`UNVERIFIED`). | ~600+ orders/month, or the Phase 10 timing measurement shows manual processing does not fit in a working day |
| **ADR-010** | **Cloud Run `min-instances=0`** | `min-instances=1` costs ~$9.72/month before offset. Idle instances that are *not* minimum instances are not charged, so a 5-minute keep-warm ping delivers the same result for approximately nothing. | Phase 21 shows cold starts measurably hurt conversion |
| **ADR-011** | **In-process catalog cache**, short TTL | ~20 lines of code that quadruples Supabase egress headroom — from ~250,000 to ~1,000,000 pageviews/month against the 5 GB cliff. | Multi-instance cache coherence becomes a real problem, which at `max-instances=3` and a 60-second TTL it is not |
| **ADR-012** | **Server-side price resolution, always** | The client never sends a price. The gift-card defect (`data-price="2000"` regardless of the ₹1,000–10,000 selection) proves this failure mode is already live in the legacy code. | Never |
| **ADR-013** | **Webhook-driven payment state** | Order state is driven by the verified Razorpay webhook, never the browser callback. A trusted callback is a free-order exploit. | Never |
| **ADR-014** | **DB inventory locking** — `SELECT … FOR UPDATE` inside a transaction with `CHECK (quantity_available >= 0)` | Application logic alone is not sufficient. The constraint is the backstop that catches the bug the application logic will eventually have. | Never |
| **ADR-015** | **Razorpay call outside the row lock** | The PDF: "worth more than any infrastructure choice for checkout throughput." Holding a row lock across a third-party network call serialises checkout on that provider's latency. | Never |
| **ADR-016** | *(new, Phase 0)* **Application stays nested at `vokr/`** rather than flattening to the repo root | The reference material (PDF, legacy site, scope doc) legitimately lives beside the app, and the repo root is the natural home for this plan. Flattening churns history for no functional gain; CI and the Dockerfile simply set a working directory. | A second deployable appears, at which point a proper monorepo layout is warranted |
| **ADR-017** | *(new, Phase 0)* **Reference material is tracked in git** — the PDF, the backend scope, and one canonical copy of the legacy site | The plan cites the PDF by section and Phase 4 migrates from the zip. A fresh clone must be self-sufficient. The 19.9 MB base64 homepage and the near-duplicate zip are excluded — the former is the exact artefact R21 eliminates. | Repository size becomes a problem, which at ~1.9 MB it will not |
| **ADR-018** | *(new, Phase 0)* **`output: "standalone"`** | Artifact Registry's 0.5 GB is the tightest quota in the stack; a conventional Next.js image is 150–400 MB. Standalone produces 29 MB. | Never, while the registry quota stands |
| **ADR-019** | *(new, Phase 0)* **`typecheck` runs `next typegen` first** | The App Router's route-aware globals live in the git-ignored `.next/types`. Without typegen, `tsc --noEmit` fails on any clean checkout — which is exactly what CI is. | Next.js stops generating route types |
| **ADR-020** | *(new, Phase 0)* **`noUncheckedIndexedAccess` enabled** | Free to adopt at four files; painful to retrofit across a codebase that will index cart lines, variant maps and pricing arrays. It is the strictness flag that most directly prevents undefined-at-runtime bugs in the money path. | Never |
| **ADR-021** | *(new, Phase 0)* **`include` globs, not `allowJs`, keep untyped JS out** | `next typegen` re-adds `allowJs: true` on every run, so fighting it produces a permanently dirty tree. The `include` list (`**/*.ts`, `**/*.tsx`, `**/*.mts`) is what actually gates the program. | Never widen `include` to `**/*.js` |
| **ADR-022** | *(new, Phase 0)* **Money is stored as integer paise** | No float, no decimal-string ambiguity, no rounding drift across the pricing → payment → invoice chain. Int32 tops out around ₹21.4M, far above any Vokr line item. | An order line could exceed ₹21.4M, or multi-currency arrives |
| **ADR-023** | *(new, Phase 0)* **Deterministic lock ordering (`ORDER BY variant_id`) in the reservation transaction** | Without it, two carts holding the same two variants in opposite order deadlock under concurrency — and Phase 21 at 25 buyers will find it. | Never |
| **ADR-024** | *(new, Phase 0)* **Erasure anonymises PII in place and retains the financial record** | DPDP erasure and the 8-year Indian tax retention obligation genuinely conflict. Deleting the order is not lawful; keeping the PII is not either. The resolution is stated in the privacy policy rather than hidden. | Legal advice says otherwise |

---

## 12. Definition of Done

A phase is not complete because the code compiles. It is complete when
**all** of the following are true.

1. **Implementation** — every task in the phase's Implementation Tasks list is done, or explicitly deferred with a recorded reason and a new task in a later phase.
2. **Tests** — the phase's Testing Requirements are all written and passing. Any bug found during the phase has a regression test that fails without the fix.
3. **Validation** — the phase's Validation steps have actually been performed, not reasoned about. Where the phase names a manual verification (a delivered email, a restore drill, a real shipment), **it has been done and evidenced.**
4. **Error handling** — every failure path is handled and returns through `toErrorResponse()`. No unhandled rejection, no leaked internal message, no silent catch.
5. **Security** — the phase's Security Requirements are met, tests included. AuthZ verified for every new route. No secret reachable from the client.
6. **Observability** — new failure modes are logged with a request ID, surfaced to Sentry with PII scrubbed, and alertable where a silent failure would be costly.
7. **Configuration** — new environment variables are in `env.ts`, `.env.example` and (for production) Secret Manager, within the six-version limit.
8. **Migration safety** — schema changes are reversible or expand/contract; tested against a copy of production data; a rollback of application code never faces a schema it cannot read.
9. **Documentation** — README, AGENTS.md and any runbook updated. **This plan's phase Status, §0 header, §0.2 evidence log and §6 R-mapping updated in the same commit.**
10. **Git** — a clean, scoped commit with a message explaining *why*. No secret, no generated file, no unrelated formatting churn.
11. **Regression verification** — `npm run verify` passes, plus the security and (from Phase 8) concurrency suites. Earlier phases' tests still pass.
12. **Exit criteria** — the phase's stated Exit Criteria are demonstrably met.

**A phase whose exit criteria depend on a manual verification is not
complete until that verification has been performed.** R12 is not done
because SMTP is configured — it is done when an email arrives in an inbox
outside the project team. R17 is not done because backups run — it is done
when a restore has succeeded.

---

## 13. Final Production Readiness Gate

**The application must not be called production-ready until every blocking
item below is verified with evidence.** There is no partial credit.

### 13.1 Application
- [ ] Single Next.js deployable; all 27 legacy pages represented
- [ ] No dead forms; every form posts to a real endpoint
- [ ] Error, loading and not-found states on every route
- [ ] Responsive at 360 / 768 / 1024 / 1440 px
- [ ] Zero serious/critical accessibility violations
- [ ] `robots.txt` and `sitemap.xml` generated from real routes

### 13.2 Catalog
- [ ] Five SKUs (**D1**: gift cards deferred) with stable variant IDs and unique SKUs
- [ ] Real prices, server-resolved, verified against the price list
- [ ] Real stock quantities entered
- [ ] Real product photography, no third-party CDN
- [ ] **No phantom products** — "Model 251 Low" and "Masks" absent from the catalog and the search index
- [ ] Per-variant GST rate and HSN code, confirmed by the CA (**D2**)

### 13.3 Database
- [ ] All migrations applied to production
- [ ] Every constraint and index from §3.5 present and verified
- [ ] `CHECK (quantity_available >= 0)` proven to fire
- [ ] No `SELECT *` anywhere
- [ ] No images, no logs in Postgres
- [ ] Pruning jobs running for carts, rate limits, reservations, webhooks, guest sessions

### 13.4 Authentication & guest sessions
- [ ] Email/password and Google sign-in working
- [ ] **R12: a confirmation email delivered to an external address via Brevo** ✱
- [ ] **R13: Auth email rate limit raised; client IP forwarded** ✱
- [ ] Guest browsing, guest checkout, guest → user transition with token rotation
- [ ] Password reset working
- [ ] Service-role key absent from every client bundle

### 13.5 Cart & checkout
- [ ] Server-side cart persisting across sessions; merge on sign-in idempotent
- [ ] **R6: no endpoint accepts a price; client-controlled-pricing regression test passing** ✱
- [ ] Address capture, PIN serviceability, COD eligibility; unknown PIN fails closed
- [ ] **R11: per-variant GST with correct CGST/SGST vs IGST split** ✱
- [ ] One authoritative pricing snapshot per checkout session
- [ ] **R8: idempotency keys on order and payment creation** ✱

### 13.6 Payments
- [ ] **R7: webhook signature verified constant-time on the raw body** ✱
- [ ] Payment state driven only by webhooks; forged browser callback grants nothing
- [ ] Duplicate and out-of-order webhooks handled
- [ ] Reconciliation job resolving undelivered webhooks
- [ ] **R16: Razorpay live-mode KYC complete** ✱ (**D3**)
- [ ] A real prepaid order placed, captured and refunded

### 13.7 Inventory
- [ ] **R9: reservation inside a transaction with `FOR UPDATE`; Razorpay outside the lock** ✱
- [ ] Deterministic lock ordering; zero deadlocks under load
- [ ] Reservation expiry returning stock
- [ ] Sold-out states visible to customers

### 13.8 Orders & fulfilment
- [ ] Every captured payment produces exactly one order; zero orphans
- [ ] `VK-#####` numbering, unique, never reused
- [ ] Guest lookup rate-limited and enumeration-resistant
- [ ] **R11: sequential, gapless, GST-compliant invoices** ✱
- [ ] **R15: Shiprocket live with COD and PIN serviceability; a real order shipped** ✱
- [ ] COD lifecycle including remittance reconciliation; RTO handled
- [ ] A real COD order placed and delivered
- [ ] Fulfilment runbook written and followed by a second person

### 13.9 Email
- [ ] All six transactional emails sending and arriving
- [ ] Exactly one email per state transition
- [ ] Email failure never affects order integrity
- [ ] Brevo 200/day alert live
- [ ] Free-plan branding question resolved by inspecting a real email

### 13.10 Admin / operations
- [ ] Store fully operable without database access
- [ ] Every admin mutation audit-logged
- [ ] Exception views for every inconsistency class
- [ ] Admin restricted at both application and Cloudflare layers

### 13.11 Images & storage
- [ ] **R21: homepage under 500 KB, enforced in CI** ✱
- [ ] **R21: zero `cdn.shopify.com` references; zero large base64 payloads** ✱
- [ ] Responsive WebP/AVIF from R2 with immutable caching
- [ ] Alt text on every image

### 13.12 Backups & recovery
- [ ] **R17: 6-hourly `pg_dump` to R2, verified, with retention** ✱
- [ ] **R17: a real restore performed, integration suite passing against it, RTO recorded** ✱
- [ ] Disaster-recovery runbook followed by a second person
- [ ] Quarterly restore drills scheduled

### 13.13 Monitoring & logging
- [ ] Sentry live with **PII scrubbing proven by test** and spike protection enabled
- [ ] Structured logging with request IDs
- [ ] `/api/health` touching Postgres, pinged every 5 minutes
- [ ] Webhook silence alertable
- [ ] **R22: weekly Cloud Logging export to R2** ✱
- [ ] Every alert fired at least once and observed

### 13.14 Security
- [ ] **R19: HTTPS, HSTS with preload, CSP enforced** ✱
- [ ] **R19: full rate-limit matrix live at both layers** ✱
- [ ] **R19: 5 WAF rules deployed; bot protection on** ✱
- [ ] Route-by-route authorisation matrix complete, one passing test per row
- [ ] Enumeration resistance verified on order and return lookup
- [ ] Zero secrets in any client bundle (CI-enforced)
- [ ] Origin unreachable except through Cloudflare
- [ ] Dependency scan clean at the defined severity
- [ ] Security review complete, no unaddressed high findings

### 13.15 Privacy
- [ ] **R22: purpose-specific consent records, append-only** ✱
- [ ] **R22: export and erasure endpoints, full cycle verified** ✱
- [ ] Addresses and phones encrypted at rest; a raw dump shows ciphertext
- [ ] Retention enforced automatically
- [ ] `grievance@vokr.shop` receiving, with an owner and an SLA
- [ ] Privacy policy matches the implementation
- [ ] Data inventory complete; export coverage CI-enforced

### 13.16 Performance & load
- [ ] **R10: 10 / 25 / 50 concurrent buyers on one variant, all three executed** ✱
- [ ] **R10: zero overselling, zero duplicate orders, zero deadlocks, zero 5xx** ✱
- [ ] **R10: payment/order consistency verified at every level** ✱
- [ ] **R18: catalog cache verified single-flight; egress per pageview measured** ✱
- [ ] Core Web Vitals passing on mobile
- [ ] Cold-start time measured with and without keep-warm

### 13.17 CI/CD & infrastructure
- [ ] **R1: every change reaches production only through the pipeline** ✱
- [ ] **R2: Artifact Registry cleanup policy active; registry under quota** ✱
- [ ] **R3: exactly 6 Secret Manager versions, loaded at boot; rotation proven** ✱
- [ ] **R4: `max-instances=3` verified via API** ✱
- [ ] **R4: billing budget alerts at $1/$5/$20, one observed firing** ✱
- [ ] **R5: staging on Razorpay sandbox, enforced at boot** ✱
- [ ] `NEXT_PUBLIC_SITE_URL` correct in the production image (§2.5 trap closed)
- [ ] All three Cloud Scheduler jobs green
- [ ] Cloudflare DNS, SSL, cache rules correct; no identity-bearing response cached
- [ ] All five `@vokr.shop` mailboxes receiving
- [ ] Rollback performed and timed

### 13.18 Content & legal
- [ ] **R14: terms say "email", not "email/SMS"** ✱
- [ ] **R20: zero fabricated reviews, ratings or review counts, CI-enforced** ✱
- [ ] Every published claim verified or removed
- [ ] Terms, privacy, returns and shipping copy match the implementation
- [ ] Legal review completed

### 13.19 Launch
- [ ] All 22 blocking requirements **VERIFIED** with evidence in §6
- [ ] All three open decisions (D1, D2, D3) resolved
- [ ] Go/no-go recorded with a named decision-maker
- [ ] Launch-day plan written; owners assigned
- [ ] First-24-hour and first-week watch scheduled

✱ = maps directly to a numbered blocking requirement in §6.

---

### Final statement

**Vokr is production-ready only when §6 shows 22 of 22 VERIFIED, every box
in §13 is checked with evidence, and D1–D3 are resolved.**

Until then it is, in the PDF's own words, *ready to build, not ready to
launch.*
