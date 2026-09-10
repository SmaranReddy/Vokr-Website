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
| **Current phase** | Phase 5 — Server-Side Cart — **COMPLETE, 12 Sep 2026** (`carts`/`cart_items` migrated with the §3.5 constraints; server-resolved pricing and per-variant GST on every read; guest→user merge registered on the Phase 3 upgrade hook, idempotent under genuine concurrency; cart UI wired into the header and PDP, closing the cart/Bag and Add-to-Cart half of D5; see Phase 5 Status). **Phase 6 not started.** |
| **Current status** | Phase 5 engineering complete and verified. **12 Sep 2026: `carts`/`cart_items` added (`20260910084234_cart`) with the two partial unique indexes making "one open cart per identity" a database guarantee, a CHECK scoped to `status='open'` only (a closed/merged cart legitimately outlives its guest session — found by this phase's own merge test, see Phase 5 Status), and RLS enabled with no policies, matching every prior migration's convention. `src/server/cart/` resolves unit price, line subtotal and per-variant GST from `product_variants`/`products` on every read — `cart_items` itself stores no price — and a `.strict()` zod boundary rejects any request body carrying `price`/`total`, closing the legacy client-controlled-pricing defect generically for all five launch SKUs (R6). The guest→user merge handler is registered against the Phase 3 upgrade hook and proven idempotent under a genuinely concurrent double-fired sign-in (a `SELECT ... FOR UPDATE` guard on the guest cart row), not just a sequential retry. **One real defect found and fixed mid-phase:** `completeSignIn()` created the `app_users` row *after* running upgrade handlers, so the cart-merge handler's FK to `app_users(id)` failed on a brand-new user's first sign-in with items in their guest cart — reordered so the profile row exists before any handler runs. Cart UI (drawer, quantity controls, line removal, live totals, out-of-stock-per-line) wired into `src/app/layout.tsx`, the header Bag button and the PDP Add to Cart button, replacing their Phase 4 D5 inert state for real. `npm run verify` green (lint, typecheck, 205/205 unit tests / 23 files, build); `npm run test:integration` green (52/52 / 8 files) against a disposable local Postgres — this sandbox still cannot reach the real Supabase project. Full flow (add, quantity update, remove, R6 price-injection attempt) exercised against a live `next dev` server via real HTTP requests with real cookies; not visually screenshotted in an actual browser window — no browser-automation tool is available in this sandbox. See Phase 5 Status for the full evidence.** |
| **Latest relevant commit** | *(Phase 5 commit — SHA to be recorded)* |
| **Blocking issues** | D1 RESOLVED (8 Sep 2026) — see §0.3. 2 open human decisions remain (D2, D3). The real Supabase project task is RESOLVED (8 Sep 2026) — see Phase 2 Status. **D2 does not block Phase 2 or Phase 3** — the schema defers GST rate/HSN via a nullable `gst_rate_bps` plus a trigger that refuses to let any variant go active without one. D2 blocks R11 (compliant invoicing) and therefore live sales. **New: Phase 3's exit criterion (R12 — a confirmation email delivered to an external inbox via Brevo) requires a Brevo account, a verified sending domain, and Google OAuth credentials, none of which exist in this environment — see Phase 3 Status for the exact human checklist.** **Google OAuth is DEFERRED to Phase 4 task 14 (10 Sep 2026, operator instruction, recorded under §12 item 1) and is no longer counted as a Phase 3 blocker — see Phase 3 open item 4.** **D4 RESOLVED (10 Sep 2026): `auth.rate_limit.email_sent` stays at 30/hour by decision. No Phase 3 blocker remains except the scoped commit itself.** |
| **Launch gate** | NOT PASSED. 0 of 22 blocking requirements verified. |
| **Standing constraints** | **§2A — Legacy Content Preservation.** The approved legacy structure and content may not be altered during migration without explicit manager approval. Permanent, all phases. Registered exceptions and everything awaiting approval live in §2A.6. |
| **Domain / DNS** | `vokr.shop`, DNS managed at **Hostinger** (§3.7) — *not* Cloudflare, despite §3.1's target state. Brevo domain authentication is **in progress**: records added in Hostinger, Brevo verification still pending. |

### 0.1 Master checklist

- [x] **Phase 0** — Current-State Audit + Foundation Corrections
- [x] **Phase 1** — Foundation Stabilization
- [x] **Phase 2** — Catalog + Database (real Supabase project now linked and seeded — see Phase 2 Status)
- [x] **Phase 3** — Authentication + Guest Sessions (**COMPLETE, 10 Sep 2026** — all acceptance criteria and the Exit Criterion met or deferred under §12 item 1; Google OAuth deferred to Phase 4 task 14. Closed by `f89e7ba` — see Phase 3 Status)
- [x] **Phase 4** — Website / Page Migration (**CLOSED, 12 Sep 2026** — 26/26 legacy pages migrated (21 marketing/support/legal pages + one dynamic PDP template serving the 5 shop slugs); real forms, robots/sitemap, WCAG AA contrast pass done. **§2A.7 fidelity + axe + responsive screenshots verified for all 26/26 pages**, including the 5 PDP routes against a disposable local-Postgres validation database (§0.2) — this sandbox still cannot reach the real Supabase project. **D5 resolved 12 Sep 2026**: manager approved option B — the header cart/Bag button, PDP "Add to Cart" button, Order Status form and reviews "Write a Review" remain visible-but-inert through Phase 4 as an explicit, time-boxed §2A.6 exception, expiring when Phases 5/7/9 ship the real capability. Reviews Filters/Sort — never part of that exception — are now real (`reviews-list.tsx`). **Open but not closure-blocking, per the plan's own design**: tasks 7/8/9 (🔒, §2A.6 manager approval; Acceptance-Criteria-waivable) and task 14 (Google OAuth, needs external dashboard access this environment doesn't have). See Phase 4 Status.)
- [x] **Phase 5** — Server-Side Cart (**COMPLETE, 12 Sep 2026** — `carts`/`cart_items` migrated with the §3.5 constraints; server-resolved price/GST on every read, no endpoint accepts a client price; guest→user merge idempotent under real concurrency; cart UI live in the header and PDP. See Phase 5 Status)
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
| 3 (engineering only — see Phase 3 Status) | 8 Sep 2026 | `7805883` | `npm run verify` green from a clean `.next/` (75/75 unit tests, 13 files); `npm run test:integration` green against Compose Postgres, run 4× consecutively for flake-check (31/31 tests, 5 files: guest-session create/reuse/expiry/UNIQUE/CHECK/RLS, `app_users` idempotent-upsert-under-concurrency/UNIQUE-email/RLS, `rate_limit_counters` limit-and-block/window-reset/20-way-concurrent-race/independent-buckets/CHECK/RLS, `completeSignIn` guest-upgrade-handler/cookie-rotation/idempotent-retry); `next dev` + `curl`/`Invoke-WebRequest` against all five live auth routes plus all four auth pages — every route returns a well-formed `toErrorResponse()` JSON body (or, for the OAuth callback, a 307 redirect) rather than an unhandled crash, confirmed against the actual "Supabase not configured" failure this environment is in; dev-server log inspected for stray stack traces (none); `grep` of a clean `.next/static` production build for `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`, `R2_SECRET_ACCESS_KEY`, `SENTRY_AUTH_TOKEN`, `DATABASE_URL`, `DIRECT_URL` returns zero matches (a regression was found and fixed mid-phase — see Phase 3 Status). **Not evidenced, and cannot be from this environment: R12 (external-inbox email delivery), R13's Google OAuth half (needs a real Google Cloud OAuth client) — these require a human with Brevo/Google Cloud dashboard access.** |
| 3 — production migration (`20260908102243_auth_guest_sessions`) | 10 Sep 2026 | `f89e7bae83abd53373bf45a70d14dd780e21d25d` | **Migration `20260908102243_auth_guest_sessions` deployed to the real Supabase project `fzjuiocvzqaycchwsjef` (ap-south-1).** Procedure: `npx prisma migrate deploy` with `DATABASE_URL`/`DIRECT_URL` both set to the **session pooler, port 5432** as one-off process env vars (README §"Database — real Supabase project"); never written to `.env.local` or any repository file, deleted after use. **`supabase config push` deliberately not used** (it would set `auth.email.enable_confirmations` true→false). No Auth, SMTP, MFA, SMS, pooler or storage setting altered; no seed run. **Pre-flight:** `prisma migrate status` → `init_catalog` already applied, exactly one pending, no drift/failed/modified-after-apply. **Apply:** exit 0, `Applying migration 20260908102243_auth_guest_sessions` → "All migrations have been successfully applied." **`_prisma_migrations` read back:** both rows `applied_steps_count=1`, `rolled_back_at=null`; the new row `finished_at 2026-09-09 19:56:26 UTC` (= 10 Sep 01:26 IST). `prisma migrate status` → **"Database schema is up to date!"** exit 0. **Objects verified by direct `information_schema`/`pg_catalog` query:** `app_users` (6 cols), `guest_sessions` (5 cols), `rate_limit_counters` (3 cols); 3 PKs; 2 unique indexes (`app_users_email_key`, `guest_sessions_token_hash_key`); 2 plain indexes (`guest_sessions_expires_at_idx`, `rate_limit_counters_window_start_idx`); 2 CHECKs (`guest_sessions_expires_after_created`, `rate_limit_counters_count_non_negative`); **RLS enabled on all three, zero policies in `public`**; no FKs (correct — `app_users.id` is cross-schema by design). **Non-destruction verified:** `products` 5 rows, `product_variants` 27, `inventory` 27 — unchanged; all Phase 2 CHECKs, both FKs, the `catalog_status` enum and the `product_variants_require_gst_rate` trigger intact, trigger **enabled** (`tgenabled='O'`). **GST/HSN untouched (D2 still open):** all 5 products `hsn_code=NULL`, `gst_rate_bps=NULL`; all 27 variants `draft`; **0** active variants on a GST-less product — nothing purchasable, exactly the pre-migration state. **No unexpected objects:** `public` holds exactly 7 tables (6 application + `_prisma_migrations`), 1 trigger, 1 function, 1 enum, 0 views, 0 sequences, 0 policies. **PostgREST anon-key survey:** `app_users`, `guest_sessions`, `rate_limit_counters` all moved `PGRST205` → `42501`, and `products`/`product_variants`/`inventory` still `42501` — present with `anon` correctly denied SELECT. **Containment:** credential file deleted; repo-wide scan for `aws-0-ap-south-1.pooler` returns only pre-existing password-free hits (`.env.example` template, `README.md`, git-ignored `supabase/.temp/pooler-url`); `.env.local` still points at local Compose Postgres on 55432. |
| 3 — password reset (real-world, cross-browser) | 10 Sep 2026 | `f89e7bae83abd53373bf45a70d14dd780e21d25d` | **One fresh real-world password reset completed end-to-end against `smaranreddy1011@gmail.com`, closing Phase 3 open item 2.** **Send:** `POST /api/auth/reset` at **2026-09-09 20:14:50 UTC** (10 Sep 01:44:50 IST) → **HTTP 200** in 1.674 s. **Send proven genuine, not a swallowed failure:** the route's `classifyResetResult()` splits four ways and logs on three of them — `validation` (400, logged), `operational` (500, logged), `silent-failure` (**200, logged**) and `generic-success` (200, *not* logged). The dev log contains **zero `[auth/reset]` entries**, so the only reachable path is `generic-success`, i.e. `resetPasswordForEmail()` returned `error: null`: Supabase Auth accepted and dispatched via Brevo SMTP with no error. This rules out SMTP failure, provider rejection and the 30/hour cap. **Template confirmed live:** the delivered email's link pointed at `/api/auth/reset/confirm?token_hash=…&type=recovery` — the `{{ .TokenHash }}` template, not the old `{{ .ConfirmationURL }}` PKCE URL. **The decisive step — cross-browser:** the reset was requested in the normal browser and the emailed link **opened in a separate Incognito/private window**, which reached the *Set a new password* form; the new password was set and then signed in successfully. **This is precisely the condition round 3 proved broken** (`AuthPKCECodeVerifierMissingError`, the verifier cookie existing only in the requesting browser), so the server-side `verifyOtp({type:"recovery"})` fix is now confirmed against a genuine PKCE-issued, Brevo-delivered token rather than only an admin-generated one. **`app_users` corroboration (local Compose — the dev server was verified to be on local Postgres, not production):** the sign-in ran `getOrCreateAppUser()` (upsert transaction visible in the dev log, ending `COMMIT`) and produced **no new row** — `b8f70250-0c8b-4d9b-a2ce-280c30bdde8e` / `smaranreddy1011@gmail.com` retains its original `created_at 2026-09-09 09:12:31.342+00`, confirming task 8's idempotent upsert. **`/api/auth/reset/confirm` correctly left no `app_users`/guest trace**, since `completeSignIn()` is deliberately not run on the recovery route (round 3 security property). **Dev-server hygiene verified before the test:** a probe request moved local `rate_limit_counters` 9⇒11 (+2 — independent IP-keyed and email-keyed windows), proving the server was reading **local Compose Postgres, not production**, so the Cause-2 trap was absent. **Not read back:** the project's `auth.users` row (`recovery_sent_at` / `updated_at` / `last_sign_in_at`) — requires the service-role key, which is not present in this environment. The successful sign-in with the *new* password is itself server-side proof the credential changed. |
| 3 — closure (R13 test, anti-enumeration test, D4, prefetch decision) | 10 Sep 2026 | `f89e7bae83abd53373bf45a70d14dd780e21d25d` | **The last three Phase 3 open items closed; no production configuration changed.** **R13 per-IP verification (new):** `src/server/rate-limit/__tests__/client-ip-bucketing.integration.test.ts`, **6 cases**. Behavioural, against real Postgres: two different forwarded client IPs occupy independent buckets (one exhausting its allowance leaves the other at full remaining) — the failure R13 names, where server-side Auth calls put every customer in Cloud Run's single egress bucket; `cf-connecting-ip` takes precedence over a spoofed `x-forwarded-for`, so a client cannot borrow another visitor's bucket behind Cloudflare; and a **genuinely separate `PrismaClient`** with its own connection pool, standing in for a second Cloud Run instance, observes the counter the first advanced (`count = 5`) rather than receiving its own fresh allowance — the per-instance failure mode an in-memory limiter would exhibit. Structural, by source assertion (route modules sit outside the Vitest `node` project, so this follows the convention of `env-client-inlining.test.ts`): all three limited routes call `getClientIp(request)` and interpolate it into the key, so a regression to a constant key would fail. **The limiter itself was not modified.** **Anti-enumeration (new):** `src/server/auth/__tests__/anti-enumeration.test.ts`, **9 cases**, closing a gap open since the phase began. Tested at the classifier layer — `classifySignupResult()` / `classifyResetResult()` are what actually select the caller-visible outcome, so the long-standing objection (“a meaningful test needs real Supabase responses”) applies to the routes, not to them. Asserts the **caller-visible projection** (status + message) is identical for registered vs unregistered on both surfaces, rather than `outcome.kind` equality — which would wrongly fail on reset, where `silent-failure` and `generic-success` differ internally but are indistinguishable by design. Covers `user_already_exists`, `email_exists`, the confirmations-on duplicate shape, and GoTrue's recovery cooldown (keyed on `recovery_sent_at`, therefore reachable only for a registered address — the sharpest oracle in the phase). Two counter-tests assert the rule is not over-applied: an SMTP failure on either route must still fail loudly. **D4 resolved:** `auth.rate_limit.email_sent` **kept at 30/hour** as an intentional launch decision; **the Supabase dashboard was not touched and `config push` was not used.** **Mail-scanner prefetch:** risk explicitly accepted for launch with current behaviour retained, re-open conditions recorded (open item 8). **Full gate:** `npm run verify` **exit 0** from a deleted `.next` — lint clean, typecheck clean, **189 unit tests / 21 files**, build clean with 16 static pages; `npm run test:integration` **37 / 6** against Compose Postgres. The running dev server (PID 19668) was stopped first, since it shared `.next`. **Bundle secrets:** `grep` of a clean `.next/static` returns **0 matches** for all eight server-secret names (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`, `R2_SECRET_ACCESS_KEY`, `SENTRY_AUTH_TOKEN`, `DATABASE_URL`, `DIRECT_URL`) and 0 for the local DB password literal, while the three `NEXT_PUBLIC_*` values each appear in exactly 1 chunk — both halves of the round-3 inlining regression still correct. |
| 4 — website / page migration (engineering, see Phase 4 Status for what remains) | 10 Sep 2026 | `3cbcc059d97e06d77efd83300261fd635d1244de` | **26/26 legacy pages migrated** (21 static marketing/support/legal routes + one dynamic `app/shop/[slug]/page.tsx` template serving the 5 launch SKUs), verified by direct crawl of a live `next dev` server: every route (plus `/search`, `/robots.txt`, `/sitemap.xml`) returns **200**; `gift-cards` returns **404** (D1 still the only IA change). **§2A.7 fidelity** (text-content diff + heading/landmark diff against the tracked `vokr-production.zip`, via a purpose-built Playwright/jsdom harness at `e2e/fidelity/extract.ts` + `e2e/phase4-fidelity.spec.ts`): **21/21 non-PDP routes pass** — 20 byte-exact after whitespace/`sr-only` normalisation, 1 (`/reviews`) passes a documented superset check because the legacy's own review-card list is populated by client JS the static extraction never executes, not because any static copy was dropped (see that spec file's doc comment). Six real transcription defects were found and fixed by this harness during the phase (missing `<sup>i</sup>` info-icon markers, two testimonials silently dropped, an unmounted quiz-modal step losing its headings, "Shop Now" substituted for the legacy's actual "Add to Cart" label, a missing "Learn More" link, and `&ldquo;/&rdquo;` smart quotes substituted for the legacy's straight quotes) — evidence the check is load-bearing, not decorative. **Accessibility** (`@axe-core/playwright`, WCAG2A+2AA tags, `e2e/phase4-routes.spec.ts`): **21/21 non-PDP routes, zero serious/critical violations**, after darkening the legacy's `#888/#999/#aaa` greys (2.6–3.5:1 on white) and the review "Verified Buyer" green to WCAG-AA-passing values in `globals.css` and `reviews-summary.tsx` — a colour-only change, not a content change, per §2A.4. **Responsive screenshot spec** (`e2e/phase4-responsive.spec.ts`, 360/768/1024/1440 px) built and proven against the homepage; not run for all 26 routes in this session (time, not a blocker). `npm run verify` **exit 0** from a clean `.next`/`node_modules` state: lint clean, typecheck clean, **190/190 unit tests / 21 files**, production build clean (all 26 content routes + existing API/auth routes compiled; `/shop/[slug]` prerenders 0 params and falls back to on-demand rendering rather than failing the build, see task below). **Legacy source integrity:** `index (7).html` MD5 still `82aa900609d7bae122064c87925308b4` (matches §2A.1 exactly); `git status`/`git diff --stat` on `vokr-production.zip` empty. **Not evidenced from this environment: the 5 PDP routes end-to-end** (route-200, §2A.7, axe) — this sandbox has no network path to the real Supabase project (`ECONNREFUSED` on every `prisma.product.findMany()` call, confirmed both via `next dev` and a full `next build`); the PDP template code is otherwise typechecked, linted and unit-tested like everything else, and `generateStaticParams` was hardened to degrade to on-demand rendering rather than fail the whole build when the database is unreachable at build time. See Phase 4 Status for the full remaining checklist (§2A.6 approvals, Google OAuth, PDP verification). |
| 4 — PDP verification (all 26/26 routes, D5 opened) | 11 Sep 2026 | `d6d064e241d5dff7c1b378e281303bf2801afd4b` | **The 5 PDP routes verified end-to-end against a disposable local-Postgres database** — this sandbox still cannot reach the real Supabase project (`ECONNREFUSED` reconfirmed), so the project's own documented local-dev path was used instead: Docker Desktop started, a throwaway `postgres:17-alpine` container run on host port 15432 (55432 — `docker-compose.yml`'s port — sits inside a Windows/Hyper-V dynamic port-exclusion range on this machine and could not be bound; a host-networking quirk unrelated to the project, worked around without editing `docker-compose.yml`), `prisma migrate deploy` (both existing migrations applied clean) and `prisma db seed` (the real 5-product/27-variant/27-inventory-row seed — not synthetic data). **`e2e/phase4-fidelity.spec.ts` and `e2e/phase4-routes.spec.ts` both green for all 26 routes in one run each** (previously 21/26): 26/26 route-200, 26/26 §2A.7 fidelity (21 exact, 5 PDP + `/reviews` superset-around-JS-injected-cards), 26/26 axe zero-serious. `npm run build` against the same database **prerenders all 5 `/shop/*` slugs as static pages** (previously 0, on-demand fallback), confirming both the DB-reachable and DB-unreachable code paths. **Two real defects found and fixed by the verification, not invented to justify running it:** (1) `pdp-purchase-panel.tsx` rendered bare `S/M`/`One Size` instead of the legacy's `IN S/M`/`IN One Size` for socks/laces — the seed data only bakes the `IN ` prefix into adult/kids shoe sizes (`prisma/seed-data.ts`), not socks/laces; now normalised for every product. (2) The §2A.7 harness's superset handling for JS-injected review cards (`isolateLegacyContent`/`extractStructure` in `e2e/fidelity/extract.ts`) only ever matched a single contiguous substring, which happened to work for `/reviews` (no legacy text follows the injection point there) and broke on the first PDP (whose "See all 4,059 reviews →" link *does* follow it) — replaced with a sentinel-marked split that verifies every legacy segment around the injection point independently, in order. `npm run verify` (lint, typecheck, 190/190 unit tests, build) green throughout. Temporary container and `.next` removed after verification; `docker-compose.yml`, `.env.local` and the real Supabase project untouched. **D5 opened (§0.3):** the header cart button, PDP "Add to Cart" button, Order Status form and reviews Filters/Write-a-Review/Sort controls are visible-but-inert (Phases 5/9 don't exist yet to make them real) — whether that satisfies Exit Criterion "no inert form" is an unresolved plan-interpretation decision. **Phase 4 remains open pending D5**; tasks 7/8/9 (§2A.6) and task 14 (Google OAuth, external dashboard access) are unchanged from the prior row. |
| 4 — D5 refined, no new exception invented | 12 Sep 2026 | `c3d63f307f6b0769969b12f43fa04b1d8fe71d70` | **D5 re-read against task 10 and §2A.6 as literally written** (no code changed): task 10 is a strict binary, real endpoint or removed-with-§2A.6-approval, with no third "inert but labelled" option, so the four controls are re-classified individually rather than as one bucket. **Blocked, needs one manager decision each (§0.3 D5):** header cart/Bag button and PDP "Add to Cart" button (real endpoint is Phase 4's own "Explicitly Out of Scope: Cart and checkout UI"; removal needs §2A.6 approval as approved legacy structure, tasks 3/5); Order Status tracking form (real endpoint needs an `Order` model Phase 4's Database Impact explicitly excludes — Phase 9's; removal needs §2A.6 approval); reviews "Write a Review" (same `Order`-model block, plus entangled with R20/task 8, itself still pending). For each, the manager's only two options under existing rules: **(A)** approve a §2A.6 row to remove/hide until the owning phase ships it, or **(B)** approve keeping it inert as a recorded exception to task 10 — not a new automatic rule, an explicit case-by-case grant the manager must make, same authority as D1. **Not blocked — reclassified out of D5:** reviews "Filters"/"Sort" need no `Order` model or cart, operate on data already rendered client-side, and are achievable as a real capability under task 10's already-approved "implementation only" path (§2A.6 table) — this is outstanding implementation work, not a decision, and does not gate Phase 4 closure. **Nothing was removed, hidden, or given a real backend in this pass** — the refinement is documentation only, per instruction not to implement either D5 branch before the required approval exists. `Vokr-Implementation-Plan.md` §0.3 D5 and the Phase 4 Status block both updated; no other file touched. **Phase 4 still not closed.** |
| **4 — CLOSED**: D5 decided, Filters/Sort real, all evidence re-verified | 12 Sep 2026 | `6408383ce79347d80f6cbca96c973a5556c7b374` | **Manager decided D5: option B for all four controls** (header cart/Bag, PDP Add to Cart, Order Status, reviews Write a Review) — approved as an explicit, time-boxed §2A.6 exception to task 10, expiring per-control when Phases 5/7/9 ship the real capability. Recorded as a new §2A.6 table row and D5 marked RESOLVED in §0.3; nothing removed, hidden or redesigned. **Reviews Filters and Sort implemented for real** (`src/components/shop/reviews-list.tsx`, new client component): Sort reproduces `reviews.html`'s own `rrSortSelect` logic (Highest/Lowest Rated by `rating`, Most Helpful by `helpful`, Most Recent = already-correct order) — manually verified against a live `next dev` server with Playwright: Lowest-Rated and Most-Helpful orderings matched the seed data's `rating`/`helpful` fields exactly, in both cases. Filters reproduces `rrFilterBtn`'s exact-star-rating capability through an accessible control instead of the legacy's `window.prompt()` (same capability, an implementation choice) — verified narrowing 10 reviews to the 1 real 3★ review, with the button label updating to "☰ Filters (3★)" exactly as legacy. Neither touches the still-fabricated `{total} reviews` line (R20 pending) — a new, separate "Showing N of M" line is added instead, only while a filter is active. "Write a Review" stays part of the D5 exception. **Full validation re-run after the change:** `npm run lint`/`typecheck`/`test` (190/190) clean; against a fresh disposable local-Postgres validation database (same procedure as the 11 Sep row — Docker Desktop, `postgres:17-alpine` on port 15432, `prisma migrate deploy` + `prisma db seed`): `e2e/phase4-fidelity.spec.ts` **26/26 pass** (no visible text changed — Filters/Sort's labels were already present, only made real), `e2e/phase4-routes.spec.ts` **53/53 pass** (26 route-200 + gift-cards-404 + 26 axe zero-serious), `npm run build` prerenders all 5 PDP slugs. **`e2e/phase4-responsive.spec.ts` run for the first time across all 26 routes** (previously only proven on the homepage): **104/104 screenshots captured** (26 routes × 4 breakpoints), 16 MB, sane file sizes (100–140 KB each) — closes the one remaining piece of §2A.7 evidence (item 4) that hadn't been run at full scope. Screenshots are git-ignored build evidence (`e2e/screenshots/`, same as `test-results/`), not committed. **Legacy source integrity reverified:** `index (7).html` MD5 `82aa900609d7bae122064c87925308b4`; `vokr-production.zip` clean. Temporary container, `.next` and screenshot output removed after verification. **Phase 4 formally CLOSED** — every Exit Criterion met or explicitly, correctly deferred (tasks 7/8/9 §2A.6-pending, task 14 external-access-pending — neither a closure blocker by the plan's own design). Phase 5 not started. |
| **5 — CLOSED**: server-side cart, guest→user merge, cart UI live | 12 Sep 2026 | *(SHA to be recorded)* | **Schema:** `carts`/`cart_items` added (`prisma/migrations/20260910084234_cart`) with every §3.5 constraint — two hand-written partial unique indexes (`carts_one_open_per_user`, `carts_one_open_per_guest_session`, both `WHERE status = 'open'`) make "one open cart per identity" a database guarantee; `cart_items_quantity_between_1_and_10` CHECK; `carts_has_an_identity` CHECK deliberately scoped to `status <> 'open' OR …` rather than every row (see the defect below); RLS enabled on both tables, no policies, same convention as every prior migration. **Pricing (R6):** `src/server/cart/service.ts`'s `getCart()`/`addItem()`/`updateQuantity()` resolve unit price, line subtotal and per-variant GST from `product_variants.price_paise`/`products.gst_rate_bps` on every read — `cart_items` stores no price column at all. `addItemBodySchema`/`updateQuantityBodySchema` (`src/server/cart/schemas.ts`) are `.strict()`, so a request body carrying `price`/`total` fails validation before the service layer is ever reached — verified three ways: a unit test on the schema directly, an integration test confirming `addItem`'s stored line always matches the catalog price regardless of input, and a live `next dev` server hit with `curl` sending `{"variantId":…,"quantity":1,"price":1,"total":1}` → **HTTP 400** `VALIDATION_ERROR`, nothing stored. **GST math verified live**, not just in tests: adding one Model x (₹9,995, 18% GST) through the real running server returned `lineTaxPaise: 152466` (₹9,995 × 1800 ÷ 11800, half-up) and `totalPaise === subtotalPaise` (999500), confirming GST-inclusive pricing — `terms.html`'s published commitment — end-to-end. **Merge (task 5):** `src/server/cart/merge.ts` registers `mergeGuestCartIntoUserCart` on the Phase 3 upgrade hook via a side-effect import in `complete-sign-in.ts` (the one Phase 3 file this phase had a genuine reason to touch). Sums overlapping variants capped at the per-line maximum; proven idempotent under a **genuinely concurrent** double-fired sign-in (two `prisma.$transaction` calls racing the same merge via `Promise.all`, not just a sequential retry) using a raw `SELECT … FOR UPDATE WHERE status = 'open'` guard — the loser finds zero rows and is a no-op. **One real defect found and fixed mid-phase:** `completeSignIn()` created the `app_users` row *after* running upgrade handlers; the merge handler's `getOrCreateOpenCartId()` writes a `carts.user_id` row with a real FK to `app_users(id)`, which is a foreign-key violation the moment a guest with items in their cart signs in for the first time. Reordered so the profile row is guaranteed to exist first — found by, and reproduced in, `src/server/cart/__tests__/merge.integration.test.ts` before the reorder, passing after. **A second defect found by the same test:** closing a guest cart and then deleting its guest session (immediate on every sign-in) nulls `guest_session_id` via the FK, which failed the original unconditional `carts_has_an_identity` CHECK — fixed by scoping the CHECK to open carts only, since a closed cart is a historical record allowed to outlive its guest session. **Cart UI (task 7):** `src/components/cart/cart-provider.tsx` (context + `/api/cart*` client) and `cart-drawer.tsx` (quantity controls, line removal, live totals, empty state, out-of-stock-per-line) wired into `src/app/layout.tsx`; the header Bag button (`site-header.tsx`) now shows a real count and opens the drawer; the PDP "Add to Cart" button (`pdp-purchase-panel.tsx`) calls the real endpoint — both replace their Phase 4 D5 inert state, closing that half of the exception (§2A.6, §0.3 D5 addendum below). **Infra fix, not scope creep:** `vitest.config.mts`'s `integration` project set to `fileParallelism: false` — this phase is the first to add integration tests that write `products`/`product_variants`/`inventory`, exposing a pre-existing race in `catalog.integration.test.ts`'s absolute row-count assertions when run concurrently with another file touching the same tables. **Full gate:** `npm run verify` green from a clean state — lint clean, typecheck clean, **205/205 unit tests / 23 files**, build clean (cart routes present in the route table: `/api/cart`, `/api/cart/items`, `/api/cart/items/[id]`). `npm run test:integration` **52/52 / 8 files**, run against a disposable local Postgres (Docker port 15432 — port 55432 hit the same Windows/Hyper-V binding issue recorded in the Phase 4 rows; worked around the same way, `docker-compose.yml` untouched), reset and re-run clean after both defect fixes. **Live-server verification:** homepage HTML confirms the Bag button renders enabled with a real count; the PDP for `model-x` renders the size grid with 7/8 sizes correctly disabled (D2 still unresolved — only a manually activated test variant was purchasable) and the Add to Cart button reads "Select a size" pre-selection; the full add → update quantity (1→3) → remove cycle round-tripped correctly through the real `/api/cart/items` routes with real cookies. **Not verified: an actual browser screenshot** — no Playwright/browser-automation tool was available in this sandbox; the HTTP-level round trip through the exact routes the client JS calls was verified instead, and is stated as a limitation, not claimed as full visual proof. Disposable Postgres container and Docker network torn down after verification; `docker-compose.yml`, `.env.local` and the real Supabase project untouched. **Phase 5 formally CLOSED** — every Exit Criterion met (the legacy client-controlled-pricing defect is provably impossible, pinned by a regression test). Inventory *reservation* (Phase 8), checkout (Phase 6) and discount codes remain explicitly out of scope, as planned. |

### 0.3 Open decisions requiring a human

These block the phases named. They are product, tax and legal calls rather
than engineering ones, and this plan deliberately does not guess.

| # | Decision | Blocks | Why it cannot be decided here |
|---|---|---|---|
| **D1** | ~~Are gift cards sold at launch?~~ **RESOLVED (8 Sep 2026): NO.** Gift cards are deferred from launch entirely. The gift-card feature is not displayed anywhere on the website — no page, no nav/footer link, no PDP — and no purchasing, redemption or store-credit-ledger functionality is implemented. The launch catalog is **five** SKUs, not six. See §3.6 and §10A. | *(resolved — no longer blocks anything)* | Commercial decision made by the business owner. Stronger than the plan's original recommendation (a): the page itself is withheld, not merely made unpurchasable. |
| **D2** | **GST rate and HSN code per SKU.** ₹295 laces, ₹495 socks and ₹9,995 shoes are not necessarily in one slab. | R11 (compliant invoicing), and therefore live sales | R11 explicitly says "confirm current footwear slabs with your CA". Inventing a rate is a tax error, not a bug. **Does not block Phase 2** — the schema (§3.5, §3.6) stores `gst_rate_bps` as nullable per product with a `CHECK`/seed-time assertion that refuses an active variant with no rate, so catalog and database work proceeds now and an unanswered D2 fails loudly rather than shipping an invented rate. |
| **D3** | **Legal entity, PAN, GST registration and bank account** for Razorpay live-mode KYC (R16), plus the registered address printed on tax invoices (R11). | Phase 7 live mode, Phase 23 | Requires the business owner. Test mode works immediately; live mode does not. **Longest lead time in the programme — start now.** |
| **D5** | ~~Task 10 is a strict "real endpoint or removed" binary; four controls are visible-but-inert, satisfying neither.~~ **RESOLVED (12 Sep 2026): OPTION B for all four.** The header cart/Bag button, the PDP "Add to Cart" button, the Order Status tracking form, and the reviews "Write a Review" button **remain visible and inert through Phase 4**, as an explicit, manager-approved exception to task 10 — not removed, not hidden, not redesigned, and given no fabricated backend. Registered in §2A.6 as its own row (not a content/wording/navigation change — the controls are pixel-identical to the approved legacy). **Each expires when its owning phase ships the real capability:** cart/Bag and Add to Cart at Phase 5–7 close; Order Status at Phase 9 close; Write a Review at Phase 9 close, also still gated on R20 (task 8) separately. **Reviews "Filters"/"Sort" were never part of this exception** — those needed no `Order` model or cart and are now implemented for real in Phase 4 (§0.2). **Header cart/Bag and PDP Add to Cart EXPIRED, 12 Sep 2026: both now call the real Phase 5 cart API — see §0.2 Phase 5 row.** Order Status and Write a Review remain inert, unchanged, still pending Phase 9. | *(resolved — no longer blocks Phase 4 closure on this criterion)* | *Original framing, for the record:* task 10 offers only "real endpoint" or "removed-with-§2A.6-approval"; none of the four could get a real endpoint inside Phase 4's own scope boundaries (cart/checkout is Phases 5–7; order tracking needs the Phase 9 `Order` model; review submission needs both plus R20), and removing approved legacy structure needed its own approval. The choice between (A) remove/hide now or (B) keep inert as a recorded exception was manager-only, the same authority already used for D1 — not an engineering call. The manager chose (B) for all four. |
| **D4** | ~~**The production value for `auth.rate_limit.email_sent`**~~ **RESOLVED (10 Sep 2026): KEEP AT 30/hour.** Recorded as an intentional launch decision, not an oversight — the setting was deliberately left unchanged and the Supabase dashboard was not touched. **Rationale:** neither this plan nor the PDF ever specified a target above the default, and Brevo’s free allowance of 300 emails/day is ≈**12.5/hour sustained**, so 30/hour already exceeds the sustainable daily rate by more than 2×; raising it would only allow one bad hour to consume a larger share of the day’s budget and silently stop order confirmations. **Revisit if** Brevo is upgraded past the free tier (Phase 11 pre-authorises one month of Starter at $9) or the 200/day alert fires. *Original decision text follows.* — The pre-decision framing: (Supabase Auth email-send cap, per hour). Currently **30**, the post-custom-SMTP default; live-verified 10 Sep 2026. | *(resolved — no longer blocks; R13 verified 10 Sep 2026)* | **Neither this plan nor the PDF specifies a target.** Both say only “raise it from its 30/hour default” (plan Phase 3 task 2 and human-checklist item 2; PDF R13 and the Brevo row, “30/hour and is adjustable in the dashboard”); §6's R13 acceptance is just “Limit raised”. Inventing a number here would be the same class of error as inventing a GST rate (D2). **The envelope the documents do fix:** Brevo free tier is **300 emails/day** shared across transactional *and* marketing; the PDF guardrail alerts at **200/day**; ≈**4 emails/order**, so 300/day binds at roughly **70–75 orders/day**. Supabase's cap is **hourly** while Brevo's is **daily** — 300÷24 ≈ **12.5/hour sustained**, so **30/hour is already above the sustainable daily average** and raising it buys burst headroom at the cost of letting one bad hour consume a large share of the day's Brevo budget (silently stopping order confirmations). That trade-off is a launch-traffic judgement, not an engineering one. **Must be set by hand** in Authentication → Rate Limits → “Rate limit for sending emails”. **`supabase config push` must NOT be used:** `config.toml`'s local value for this key is **`2`**, so a push would *lower* production from 30/hour to 2/hour, on top of flipping `auth.email.enable_confirmations` true→false. |

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
├── vokr-production (1).zip            ← git-ignored: a third homepage export (see §2A.8)
├── index (7).html                     ← git-ignored: 19.9 MB base64 homepage variant
│                                        APPROVED LEGACY REFERENCE — never modify (§2A)
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

## 2A. Permanent Project Constraints — Legacy Content Preservation

**Issued by the project manager, 8 September 2026. These constraints are
permanent and binding on every phase — not a Phase 4 suggestion.** Where
any earlier wording in this plan could be read as licence to redesign the
approved site, this section governs.

### 2A.1 The approved legacy homepage is a source of truth

The legacy homepage is an **approved source of truth** for the Vokr
homepage's layout structure and content. It exists in this workspace in
three forms:

| Artefact | Size | MD5 | Tracked in git? |
|---|---|---|---|
| `index (7).html` (repository root) | 19,927,942 B | `82aa900609d7bae122064c87925308b4` | **No** — excluded by `.gitignore:35` |
| `vokr-production/index.html` inside `vokr-production.zip` | 109,599 B | `12492fb1f48b2808d5e7ae3a3ab9292e` | **Yes** — inside tracked blob `02c5329` |
| `vokr-production/index.html` inside `vokr-production (1).zip` | 109,599 B | `7617beef803dec0ce45d53e796021c7d` | **No** — that zip is git-ignored |

It is reference material to be reproduced faithfully. It is **not** a draft
to be improved, tidied, restructured or modernised.

### 2A.2 Provenance verification — what git can and cannot prove

*Verified 8 September 2026 by direct inspection of the working tree and the
full commit graph. The commands are recorded so this can be re-checked.*

**Established facts:**

1. **No file named exactly `index.html` exists at the repository root.**
   The root homepage artefact is named `index (7).html`. Statements in this
   plan about "the root `index.html`" refer to that file.

2. **No homepage HTML file has ever been tracked in this repository.**
   `git log --all --oneline --name-only --diff-filter=A` filtered for
   `index*.html` returns **zero** results across all nine commits
   (`5dc3b49` → `ba535b9`). The only tracked paths matching `index` are
   three TypeScript files under `vokr/src/`. `git check-ignore -v
   "index (7).html"` reports `.gitignore:35` — a rule added in Phase 0
   (`3ca3c21`).

3. **Therefore git history cannot, by itself, prove that `index (7).html`
   is unmodified.** An untracked file has no recorded history. This plan
   states that limitation rather than claiming a certainty it does not
   have.

**Corroborating evidence that it was not modified during this rebuild —
strong, but not cryptographic proof:**

| Evidence | Finding |
|---|---|
| Working tree | `git status --porcelain` is **empty**. Nothing modified, staged, or untracked-but-unignored. |
| Commit graph | No commit touches any repository-root path other than `.gitignore`, `Vokr-Implementation-Plan.md` and the three tracked reference artefacts. No commit has ever added, moved or deleted a root HTML file. |
| Filesystem timestamps | `index (7).html` carries mtime **and** ctime of **2026-09-04 11:08:29 +0530** — identical to the two zips beside it, and **three days before the first commit** in this repository (`5dc3b49`, 2026-09-07 17:00:20 +0530). On NTFS a content write updates both. No write has occurred since before the rebuild began. |
| Content cross-check | See below — the decisive evidence. |

**Content cross-check.** Strip the ten inlined base64 payloads from
`index (7).html` and diff the result against the **git-tracked**
`vokr-production/index.html`. The stripped file is 109,046 B against the
tracked file's 109,599 B, and the two differ in exactly **three** respects,
none of them structural or editorial:

1. `.footer-bottom a:hover { color: #fff; }` versus `{ color: #000; }`.
2. `index (7).html` carries one additional CSS rule the tracked copy lacks:
   `.footer-btm-links { display: flex; gap: 18px; }`.
3. Ten `<img src>` values are `data:image/…;base64,…` URIs rather than
   `cdn.shopify.com` URLs (six PNG, four JPEG — the 19.9 MB weight, and the
   exact artefact **R21** exists to eliminate). Five remote `src` values
   remain in both.

**Every section, heading, paragraph, navigation item, product block, CTA
and legal string is identical.** The approved homepage structure and
content is therefore independently corroborated by an artefact that *is*
under version control and *is* provably unchanged: `vokr-production.zip`,
blob `02c532940bc1ad1b886c9ad65bedd397e0252423`, added in `3ca3c21`
(7 Sep 2026), appearing in exactly one commit, with
`git diff HEAD -- vokr-production.zip` clean.

**Recorded conclusion.** The legacy homepage was **not modified by us at
any point during this rebuild**, and it must remain an untouched legacy
reference. Git cannot prove this *directly*, because the root artefact was
never tracked; the claim is nonetheless consistent with every piece of
evidence available — a clean tree, a commit graph that never touches it,
pre-rebuild timestamps on both mtime and ctime, and a byte-level content
match against a tracked, provably unchanged copy of the same page.

### 2A.3 The homepage artefact must not be modified

- **Do not modify `index (7).html` now.**
- **Do not modify it during Phase 4 or any future migration work.**
- Do not reformat it, re-minify it, strip its base64 payloads in place,
  "fix" its CSS, or regenerate it from the Next.js build.
- R21's base64 elimination happens **in the new Next.js implementation**
  (Phase 14). The legacy artefact keeps its base64 payloads permanently, as
  the evidence of the finding.

### 2A.4 Design and content preservation — mandatory

During migration of the legacy Vokr website into Next.js, the following are
**prohibited without explicit manager approval**:

- Changing the layout structure of the legacy pages.
- Changing content or wording.
- Changing, merging, splitting, reordering or removing sections.
- Changing navigation structure.
- Changing product presentation.
- Changing legal copy.
- Changing the information architecture.
- Removing, rewriting, rearranging or adding visible content **merely to
  make the implementation cleaner**.
- Redesigning any page based on personal or engineering preference.
- "Improving" the approved design.

The goal, stated exactly:

> **ORIGINAL APPROVED LEGACY STRUCTURE + CONTENT**
> → faithfully reproduced in the new Next.js implementation
> → with improved engineering, maintainability, performance and backend
> integration underneath.

**Technical migration is allowed. The visible structure and approved
content must remain faithful.** Replacing 27 copy-pasted stylesheets with
one Tailwind theme, five near-identical PDP files with one dynamic route,
or a dead `onsubmit="return false;"` with a real endpoint are all
implementation changes — provided the rendered page still shows the same
sections, in the same order, with the same words.

**Scope.** This constraint applies to the homepage, every other legacy page
being migrated, navigation and information architecture, and the approved
legal and content sections.

**When a legacy element appears wrong.** If a legacy element looks
incorrect, outdated, technically awkward, or conflicts with a production
requirement:

1. **Do not silently alter it.**
2. Flag it for explicit approval.
3. Record the issue and the proposed change in §2A.6 **before** any code
   changes.

**The legacy files are reference and source material. They are not
permission to redesign.**

### 2A.5 Legacy source file handling

Preserve the original legacy source files as reference material.

- Do **not** overwrite or "clean up" `index (7).html`, the other legacy
  HTML files, or the source/reference archives (`vokr-production.zip`,
  `vokr-production (1).zip`, `vokr-backend-scope.docx`).
- All migration work occurs inside the new Next.js application (`vokr/`).
- When recreating a legacy page in Next.js: **inspect the original source
  first**, preserve the approved structure and content, replace only the
  underlying implementation, and keep the original legacy file available
  for comparison and regression checking.

### 2A.6 Registered exceptions and conflict register

Every deviation from the approved legacy content — planned or proposed — is
registered here. **Nothing marked PENDING may be implemented until a
manager approves it.**

| Ref | Proposed change to approved legacy content | Why it was raised | Status under §2A |
|---|---|---|---|
| **D1** — gift cards | `gift-cards.html` not migrated, not linked from nav/footer/anywhere, unreachable by any route or sitemap entry | Commercial decision: gift cards deferred from launch | **APPROVED** — decided by the business owner, 8 Sep 2026, recorded in §0.3. Currently the only authorised change to the approved information architecture. |
| **D5** — Phase 4 task 10 exception | Four approved-legacy controls stay **visible and inert** through Phase 4 rather than getting a real endpoint or being removed: the header cart/Bag button, the PDP "Add to Cart" button, the Order Status tracking form, and the reviews "Write a Review" button. No wording, layout, section, navigation or product-presentation content changes — the controls are pixel-identical to the approved legacy, just not yet wired to a backend that doesn't exist yet. | Task 10 is otherwise a strict "real endpoint or removed" binary; none of the four can get a real endpoint inside Phase 4 (cart/checkout is Phases 5–7, order tracking needs the Phase 9 `Order` model, review submission needs both), and removing approved legacy structure needs approval of its own. | **APPROVED (option B for all four) — manager decision, 12 Sep 2026, recorded in §0.3 D5.** Not a content, wording or navigation change — an explicit, time-boxed exception to task 10's binary, expiring control-by-control when its owning phase ships: cart/Bag and Add to Cart at Phase 5–7 close, Order Status at Phase 9 close, Write a Review at Phase 9 close (also still gated on R20). **Cart/Bag and Add to Cart EXPIRED, 12 Sep 2026 (Phase 5 closed) — both now real, see §0.2 Phase 5 row.** Order Status and Write a Review remain under this exception. |
| **R14** — Phase 4 task 7 | Amend the "order confirmation email/SMS" wording in `terms.html` to "email" | SMS is deferred (TRAI DLT registration, ~₹5,900 and 3–7 days). Leaving the copy publishes a contractual promise the launch cannot honour. | **PENDING APPROVAL.** This is legal copy — §2A.4 forbids changing it unilaterally. Recommended; the alternative is to implement SMS. Do not apply until approved. |
| **R20** — Phase 4 task 8 | Delete the 10 fabricated reviews, the "4.7" average, the star breakdown and the "4,059 customer reviews" meta description; replace with an honest empty state | Consumer Protection Act 2019 exposure for fabricated reviews and ratings | **PENDING APPROVAL.** Visible content removal. Strongly recommended — this is legal exposure rather than preference — but it remains a manager's call, not an engineer's. |
| **Phase 4 task 9** | Audit and correct unverifiable marketing claims ("250,000+ people", review counts, ratings, delivery promises) | Same statute; claims must be substantiable at launch | **PENDING APPROVAL, item by item.** Each proposed change is to be added to this table with its exact before/after text before it is made. |
| **Phase 4 task 2** | Extract the duplicated legacy CSS into one Tailwind theme | Removes ~2 MB of 27-fold duplication that has already caused a defect | **ALLOWED — implementation only.** No approval needed, subject to the §2A.7 evidence requirement: the rendered page must not change. |
| **Phase 4 task 5** | Five near-identical PDP HTML files become one dynamic `app/shop/[slug]/page.tsx` | Same page, one template, data-driven | **ALLOWED — implementation only**, subject to §2A.7. |
| **Phase 4 task 10** | Dead `onsubmit="return false;"` forms bound to real endpoints | A form that silently discards customer input is a defect, not a design | **ALLOWED — implementation only** where the form is preserved and made to work. **Removing** a form is a visible-content change and needs approval. |
| **R21** — Phase 14 | Replace `cdn.shopify.com` and base64 `data:` image sources with R2-hosted WebP/AVIF | Homepage weight budget under 500 KB | **ALLOWED — implementation only.** Changes how an image is delivered, never which image, what it depicts, or where it sits on the page. |

### 2A.7 Regression evidence requirement

Because "faithful" is otherwise an assertion, each migrated page carries
comparison evidence proving the approved structure and content did not
change:

1. **Text-content diff.** Extract the visible text of the legacy page and
   of the rendered Next.js route, normalise whitespace, and diff. The diff
   must be empty, or every line in it must trace to an approved row in
   §2A.6.
2. **Structural diff.** Compare the ordered list of landmark and heading
   elements (`header`, `nav`, `main`, `section`, `footer`, and `h1`–`h6`
   with their text) between legacy and migrated. Section order and heading
   text must match.
3. **Snapshot tests** for the legal pages, so an accidental edit fails CI
   rather than reaching production. Phase 4 already requires this; §2A
   makes it non-negotiable and extends it to structure.
4. **Responsive screenshots** at 360/768/1024/1440 px, retained alongside
   the legacy rendering for visual comparison.

The legacy files stay in place precisely so these checks remain runnable
after the migration lands.

### 2A.8 Correction to an earlier claim in this plan

§2.1 and **ADR-017** describe `vokr-production (1).zip` as "identical but
one CSS hex value". Direct comparison on 8 September 2026 shows that is
**understated** for the homepage. `vokr-production/index.html` differs
between the two zips in six hunks: the `.footer-bottom a:hover` hex (`#000`
vs `#fff`), the `.ig-item` aspect ratio (`2/3` vs `1/1`) and its
flex/padding declarations, `.ig-handle` positioning (`relative` vs
`absolute` with offsets), one image `src` together with its `alt` text
("Vokr outsole detail close-up" vs "Vokr lightweight foam midsole side
profile"), and two Instagram-strip image `src` values. The three artefacts
are three distinct homepage exports, not two identical ones plus a typo.

`index (7).html` is closest to the **tracked** `vokr-production.zip` copy:
it matches that copy on every one of those points except the
`.footer-bottom a:hover` hex and the extra `.footer-btm-links` rule.

**Consequence for Phase 4.** `vokr-production.zip` (tracked, blob
`02c5329`) remains the canonical migration source for the 26 pages, but
**for the homepage specifically `index (7).html` is the newest approved
export**, and is authoritative where the two disagree on those two CSS
points. Neither file is to be edited. This discrepancy is recorded rather
than resolved by preference; if the manager wants a different canonical
homepage source, that is their decision to make.

*(The `.gitignore` comment block carries the same understated wording. It
is left untouched here because this task is documentation-only; correcting
it is a one-line follow-up.)*

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
| Domain | `vokr.shop` — **target**: Cloudflare Registrar. **Actual today: registered and DNS-managed at Hostinger (§3.7).** | The only unavoidable fixed recurring cost. The move to Cloudflare has not happened; until it does, every DNS instruction in this plan means Hostinger. |

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

### 3.7 Domain and DNS — permanent infrastructure context

*Recorded 8 September 2026. This section describes the **current
operational reality**, which is not the same as §3.1's target state.*

| Field | Value |
|---|---|
| **Domain** | `vokr.shop` |
| **DNS management location** | **Hostinger** |
| **Authority** | Hostinger is where domain records are managed **unless explicitly changed later**. Any task that says "add a DNS record" means "add it in Hostinger". |

**Conflict with §3.1 and Phase 20, recorded rather than resolved.** §3.1's
stack table names *Cloudflare Registrar* for the domain, and Phase 20
assumes *Cloudflare managing DNS for `vokr.shop`*. That is a target-state
decision that **has not happened**. Today the domain and its DNS live at
Hostinger. Phase 20 must therefore treat "move DNS to Cloudflare" as an
explicit, planned migration step with its own cutover — not as a
precondition it can assume is already true. Until that migration is
executed and verified, **every DNS instruction in this plan resolves to
Hostinger.**

This is relevant to: domain verification, email authentication, the Brevo
DNS records, future production DNS configuration, and SSL/domain setup.

#### 3.7.1 Brevo domain authentication — in progress

The intended chain, end to end:

```
vokr.shop
  → Hostinger DNS
    → Brevo domain authentication (SPF / DKIM / DMARC)
      → Supabase Auth custom SMTP
        → real external email verification   ← this is what closes R12
```

**Current state (8 September 2026):**

- The required Brevo DNS records **have been added in Hostinger**.
- Brevo domain verification is **still pending** propagation and Brevo's
  own verification check.
- **Brevo domain authentication is NOT complete, and must not be recorded
  as complete until Brevo itself reports the domain as verified.** Records
  existing in a DNS zone is not the same as a provider accepting them.
  R12 stays open until an email actually arrives in an external inbox.

**Rules attached to this work:**

- Do **not** modify the existing Zoho Mail DNS records unnecessarily. The
  five `@vokr.shop` inbound mailboxes (`support@`, `grievance@`,
  `privacy@`, `legal@`, `careers@`) depend on them, and `grievance@` is a
  statutory requirement under §9.
- SPF is the one record where inbound (Zoho) and outbound (Brevo) collide:
  a domain may publish only **one** SPF TXT record. It must be a single
  merged record covering both senders, never two competing records.
- No DNS or domain change was made as part of this documentation update.

---

## 4. Current Gaps

The distance from §2 to §3, grouped by the phase that closes it.

### 4.1 Legacy defects that must be eliminated, never migrated

The 27 static pages are **reference material, not a starting point.** Each
of these is confirmed present in `vokr-production.zip` by direct inspection:

> **Read this section together with §2A.** "Not a starting point" is a
> statement about the *implementation* — the copy-pasted CSS, the dead
> forms, the DOM-attribute pricing. It is **not** licence to change the
> approved layout, sections, wording, navigation or information
> architecture. Every row below that touches **visible content or legal
> copy** (fabricated reviews, the terms wording, unverifiable claims) is
> registered in §2A.6 and is **pending explicit manager approval**, not
> pre-authorised by appearing in this table.

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
**COMPLETE** — 8 September 2026. The real Supabase project task
(task 1) is now also resolved.

Everything in this phase's scope is implemented and verified against a
real Postgres — schema, migrations (including the hand-written CHECK
constraints, the GST-enforcement trigger and RLS), the idempotent seed,
the catalog service with its cache, both API routes, and the full test
suite (unit + integration). It was built and verified against the
`docker-compose.yml` Postgres, exactly as `.env.example` anticipated, and
that remains the target for local dev and `test:integration`.

**Real Supabase project created (8 Sep 2026):** project `Vokr`,
`ap-south-1` (Mumbai), ref `fzjuiocvzqaycchwsjef`. Repository linked via
`supabase link` (`supabase/config.toml`, `.temp/` git-ignored).
`prisma migrate deploy` applied migration `20260908055107_init_catalog`
against it; `prisma db seed` run twice, confirming idempotency (5
products / 27 variants / 27 inventory rows both times, matching the
local Compose result exactly). Read-only verification against the real
project confirmed: all three `inventory` CHECK constraints present, the
`enforce_variant_gst_rate` trigger present, RLS enabled on all three
tables, no `gift-card` slug. No table was ever hand-created in the
dashboard — the existing migration is the sole source of the real
project's schema.

**Deviation discovered during this step:** `prisma migrate deploy` (and
`prisma db seed`) fail against Supabase's transaction-mode pooler
(port 6543, `pgbouncer=true`) with `ERROR: prepared statement "s1"
already exists` — PgBouncer transaction mode doesn't support the
prepared-statement reuse Prisma's schema engine needs for DDL. Both
commands must instead run with `DATABASE_URL` pointed at the session
pooler (port 5432, the same value as `DIRECT_URL`). The running
application's normal queries still use the transaction-mode pooler
(6543) as designed — this only affects migration/seed tooling. Recorded
in `README.md` ("Database — real Supabase project") and `.env.example`.

`.env.local` was deliberately **not** repointed at the real project — it
is also loaded by `vitest.integration.setup.ts`, and `test:integration`
runs destructive checks (idempotent re-seed, CHECK-violation inserts, RLS
toggling) that must never touch production data. Local dev and
`test:integration` keep using `docker-compose.yml`'s Postgres; the real
project's `DATABASE_URL`/`DIRECT_URL` are supplied only as ad-hoc shell
environment variables for one-off `migrate deploy`/`db seed` runs. Only
the non-secret `NEXT_PUBLIC_SUPABASE_URL` was added to `.env.local`.

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

A Supabase project in Mumbai was **not** a prerequisite for the engineering
work — it turned out to be a deployment-target detail, not a blocker for
writing and testing the schema. `docker-compose.yml`'s Postgres (already
provisioned in Phase 1 for exactly this) stood in for it during
development, and remains the target for local dev and
`test:integration`. The real project now exists and is linked — see
Status above.

#### Scope
Supabase project; Prisma with dual connection strings; the schema from
§3.5 for catalog, inventory and their constraints; migrations; the
idempotent seed; a read-only catalog service with the in-process cache
(R18); the first API routes.

#### Explicitly Out of Scope
Carts, orders, payments, users — those tables land in the phases that use
them. Admin CRUD (Phase 12). Images (Phase 14). Search (Phase 13).

#### Implementation Tasks
1. ✅ Create the Supabase project in `ap-south-1` (Mumbai). Done 8 Sep 2026 by the human account owner; repository linked via `supabase link` (see Status). Engineering work was built and verified against `docker-compose.yml` Postgres first, then the migration and seed were replayed unchanged against the real project.
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
**resolved** — real project created and linked (see Status).

#### Exit Criteria
✅ A price cannot be obtained anywhere in the codebase except by passing a
variant ID to the server — verified: the only `price_paise` reads in
`src/server/` are inside `catalog/service.ts`, and it is the sole module
exporting anything price-shaped.

---

### PHASE 3 — Authentication + Guest Sessions

#### Status
**CODE COMPLETE — 8 Sep 2026. Exit criteria NOT met.** Every task that is
pure engineering (schema, session/identity resolution, guest tokens, the
guest→user transition, Postgres-backed rate limiting, the five API
routes, four auth pages, real Google button) is implemented, tested and
validated live. Tasks 1–3 are Supabase-dashboard and Google-Cloud-console
actions that require a Brevo account and Google OAuth credentials — **no
such credentials exist in this environment**, so R12 (the phase's actual
exit criterion) cannot be closed here. **Update 10 Sep 2026: the
Google-Cloud-console half of task 1 and all of human-checklist item 3 are
DEFERRED to Phase 4 task 14 by operator instruction, recorded under §12
item 1 — see Phase 3 open item 4 for the reason, the live evidence
(`"google": false`) and the resume point.** See "Human checklist to close this
phase" below the Implementation Tasks.

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
1. ◑ **Split — email/password DONE, Google DEFERRED (updated 10 Sep 2026).** The original task bundled two providers; they have diverged and are now tracked separately.
   - ✅ **Email/password: complete and verified live.** Enabled in Supabase → Authentication → Providers. Read back from the project's own `/auth/v1/settings` on 10 Sep 2026: `"email": true`, `"disable_signup": false`, `"mailer_autoconfirm": false` — i.e. email signup enabled with confirmation required, the intended launch configuration. Proven end-to-end by five real accounts created, confirmed through Brevo-delivered emails and signed in (see "Defect log round 3").
   - ⏸️ **Google OAuth: DEFERRED to Phase 4 task 14** by operator instruction, recorded under §12 Definition-of-Done item 1. The OAuth consent screen, Google Cloud OAuth 2.0 client, client ID/secret and the dev/staging redirect URLs all move there; the production redirect URL moves to Phase 20 task 12. Still unconfigured — `/auth/v1/settings` reports `"google": false` (re-read live 10 Sep 2026). Full recorded reason, evidence and resume point: Phase 3 open item 4.

   Neither half is a Phase 3 blocker any longer: the email/password half is done, and the Google half is deferred rather than pending.
2. ⛔ **BLOCKED — human required.** **Configure Brevo as custom SMTP in Supabase Auth before creating any real account.** Then raise the email rate limit from its 30/hour default (R13). Needs a Brevo account with a verified sending domain.
3. ⛔ **BLOCKED — human required.** Send a real signup confirmation to an address **outside** the project team and confirm delivery. Until that email lands in an external inbox, R12 is not done. Depends on tasks 1–2.
4. ✅ Added `app_users`, `guest_sessions` and `rate_limit_counters` migrations (`prisma/migrations/20260908102243_auth_guest_sessions/`). `app_users.id` = the Supabase `auth.users.id`, stored with no DB-level FK (cross-schema — `auth` is not Prisma-modelled) but only ever written from a verified Supabase session. Hand-added CHECK constraints (`rate_limit_counters.count >= 0`, `guest_sessions.expires_at > created_at`) and RLS enabled on all three tables, same convention as the Phase 2 migration.
5. ✅ Built `src/server/auth/session.ts` (`getSession()`, `requireUser()`) and `src/server/auth/guest.ts` (`getOrCreateGuestSession()`, `invalidateGuestSession()`, `clearGuestCookie()`). Guest tokens are 256-bit random (`src/server/auth/tokens.ts`, `crypto.randomBytes(32)`), stored as a SHA-256 hash only, cookie set `HttpOnly; Secure; SameSite=Lax; Path=/`, 90-day expiry.
6. ✅ `getSession()` always resolves to exactly one identity: an authenticated user (verified via `supabase.auth.getUser()`, never a decoded-but-unverified JWT) or a guest session, and proactively clears a stale guest cookie found alongside a valid user session rather than trusting it. Integration-tested.
7. ✅ Guest → authenticated transition built as `src/server/auth/upgrade.ts` (a handler registry — `registerGuestUpgradeHandler()` / `runGuestUpgradeHandlers()`) plus `src/server/auth/complete-sign-in.ts`, which runs the registered handlers and the guest-session deletion in one Postgres transaction, then clears the guest cookie on the response. Phase 5 registers the actual cart-merge handler here, per this phase's own Explicitly-Out-of-Scope line — Phase 3 ships the mechanism and proves it with a no-op test handler. Integration-tested for the idempotent-retry case (task 7's own requirement: "a double-fired sign-in must not double" the handler's effect).
8. ✅ `src/server/auth/app-user.ts` (`getOrCreateAppUser()`) — a single `upsert` on the primary key, called from both the sign-in route and the OAuth callback. Integration-tested under 10-way concurrent duplicate calls: exactly one row results.
9. ◑ **Partially done.** Password reset is fully implemented end-to-end: `POST /api/auth/reset` → Supabase → Brevo → `GET /api/auth/reset/confirm`, which redeems the link's `token_hash` with `verifyOtp({ type: "recovery" })` **on the server** and establishes the recovery session as cookies → `/reset-password` page (`src/components/auth/reset-password-form.tsx`) collects the new password and calls `auth.updateUser({ password })` client-side. **Corrected 9 Sep 2026:** the page used to call `exchangeCodeForSession(code)` in the browser, which needs the PKCE verifier cookie and therefore only ever worked in the browser that requested the reset — see the Phase 3 defect log round 3. **Email-change is deferred**, not built: it has no UI entry point yet, because the account/profile area it would live in is Phase 4's "account affordances" (SiteHeader) and doesn't exist. Building an isolated email-change route with nowhere in the app to reach it would be scope invented ahead of its owning phase. Revisit when Phase 4 adds an account page.
10. ✅ **Decided explicitly — ADR-025 (§11).** Every server-to-Supabase-Auth call carries the real client IP as `X-Forwarded-For` (best-effort; hosted GoTrue's trust of the header is unverifiable from here), but this app's own IP-and-email-keyed `rate_limit_counters` limiting (task 11) is the limiting this project actually relies on, not Supabase's.
11. ✅ `src/server/rate-limit/index.ts` (`consumeRateLimit()`, `assertWithinRateLimit()`) — a single `INSERT ... ON CONFLICT` fixed-window counter, atomic under concurrency (integration-tested with 20 simultaneous requests against one key: exactly `limit` succeed). Wired into all three of `/api/auth/signup`, `/signin` and `/reset`, each keyed by IP *and* by the submitted email independently.
12. ✅ Verified by `grep` — the Next.js application (`vokr/src/`) has never contained the legacy cosmetic-auth pattern; it exists only in the reference `vokr-production.zip`, which Phase 4 replaces rather than migrates.

#### Files / Areas Affected
`vokr/prisma/schema.prisma` · `vokr/prisma/migrations/20260908102243_auth_guest_sessions/` · `vokr/src/server/auth/*` · `vokr/src/server/rate-limit/*` · `vokr/src/server/net/*` · `vokr/src/app/api/auth/**` · `vokr/src/app/(auth)/**` · `vokr/src/components/auth/**` · `vokr/src/lib/env.ts` (split into `vokr/src/lib/env.ts` + `vokr/src/lib/env-client.ts` — see "A regression found and fixed mid-phase" below) · `vokr/src/lib/supabase-browser.ts` · `vokr/src/lib/errors.ts` (added `UnauthorizedError`, 401) · `vokr/src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; see below)

##### A regression found and fixed mid-phase
Two defects surfaced by the phase's own tests, not by inspection —
recorded here because the plan's own principle (§12 DoD item 2) is that a
bug found during a phase gets a regression test, not a quiet fix:
- **`src/lib/env.ts` leaking server variable *names* into the client
  bundle.** Adding the first browser-side Supabase code
  (`supabase-browser.ts`, used by the Google button and the
  reset-password page) pulled the *entire* `env.ts` module — including
  the server schema's key list (`SUPABASE_SERVICE_ROLE_KEY` etc., not
  values) — into `.next/static`, breaking the zero-server-secret-names
  bundle check every phase since Phase 1 has relied on. Fixed by
  splitting the client schema into its own module (`env-client.ts`);
  `supabase-browser.ts` imports only that. Re-verified with a clean
  production build: zero matches.
- **Two integration test files racing each other's cleanup.** `guest`,
  `app-user`, `complete-sign-in` and `rate-limit`'s integration suites
  share the `guest_sessions` and `app_users` tables and run in parallel;
  each file's `afterEach` originally did a table-wide `deleteMany({})`,
  which — run concurrently — could delete another file's row before that
  file's own assertion read it back (reproduced: `complete-sign-in`
  failed intermittently depending on run order). Fixed by scoping every
  file's cleanup to the exact row IDs it created. Re-run 4× consecutively
  with zero failures after the fix.
- **A Route Handler crash path.** In every `/api/auth/*` route,
  `createRouteSupabaseClient(request)` was originally called *before* the
  `try` block — meaning a missing `NEXT_PUBLIC_SUPABASE_ANON_KEY` (this
  environment's actual state) threw an unhandled error instead of
  returning through `toErrorResponse()`, violating DoD item 4. Fixed by
  moving construction inside `try`, with `cookiesToSet` initialised
  before it so the `catch` block can still apply any cookies queued
  before the failure. Verified live: every JSON route now returns a
  well-formed 500 body under exactly this condition instead of Next.js's
  raw error page; the OAuth callback (a redirect, not JSON) degrades to a
  307 to `/sign-in?error=oauth` instead.

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
- ✅ Service-role key never reaches the browser — `grep` of a clean `.next/static` production build for every server secret name returns zero matches (re-verified after the mid-phase `env.ts` regression, see above). No dedicated automated bundle test was added — Phase 1 and 2 both verify this the same way (manual `grep` after a clean build, recorded as evidence), and this phase follows that established convention rather than inventing a different mechanism.
- ✅ Guest tokens: cryptographically random (`crypto.randomBytes(32)`), stored as a SHA-256 hash, `HttpOnly; Secure; SameSite=Lax; Path=/`. Unit-tested (entropy/format/never-equals-raw) and integration-tested (hash round-trips correctly against the persisted row).
- ✅ Session identifier rotates on every privilege change: Supabase issues a fresh access/refresh token pair on sign-in (inherent to `signInWithPassword`), and the guest cookie is explicitly cleared on the same response.
- ✅ Rate limits on sign-up, sign-in and reset (the task list's "all three auth endpoints" — sign-out needs none, it has no enumerable target).
- ✅ Sign-in and reset responses are identical regardless of whether the address is registered — Supabase's own anti-enumeration behaviour (empty-`identities`-array on duplicate signup, generic "Invalid login credentials") is relied on rather than re-implemented; documented in the route files' own comments rather than asserted by a test that would need real Supabase responses to be meaningful.
- ✅ `MIN_PASSWORD_LENGTH = 8`, no composition rules, plus a real Have I Been Pwned k-anonymity breach check (`src/server/auth/password.ts`) — free, no API key, fails open on any network/timeout error (unit-tested for both the true/false and fail-open cases).

#### Testing Requirements
- ✅ Unit: guest token generation, hashing, cookie attributes (`src/server/auth/__tests__/tokens.test.ts`, `guest.test.ts`).
- ✅ Integration: `app_users` row created exactly once under 10-way concurrent duplicate calls (`app-user.integration.test.ts`).
- ✅ Integration: guest session created, upgraded on sign-in via the handler registry, old token invalidated and cookie cleared, retried sign-in does not re-run the handler (`complete-sign-in.integration.test.ts`).
- ✅ Integration: rate limiter blocks at the threshold, recovers after the window elapses, and serializes 20 concurrent requests against one key to exactly `limit` successes (`rate-limit/__tests__/index.integration.test.ts`).
- ✅ Security: no user enumeration through message differences — **now covered by an automated test** (`src/server/auth/__tests__/anti-enumeration.test.ts`, 9 cases), asserting the caller-visible projection is identical for registered and unregistered addresses on both signup and reset, including GoTrue's registered-only recovery cooldown. Closed 10 Sep 2026; see open item 6 for why the classifier layer is the right place to test it.
- ✅ **Manual, mandatory: DONE.** A confirmation email was delivered via Brevo to inboxes **outside** the Supabase project team, on two unrelated domains (`iiitr.ac.in`, `gmail.com`), and both reached `email_confirmed_at` — which GoTrue sets only when the emailed link is followed (round 3 evidence table, 9 Sep 2026). Five real accounts in total. **This is R12's exit criterion and it is met.** Additionally, a real Brevo-delivered *recovery* email completed the fixed reset flow cross-browser on 10 Sep 2026 (§0.2).

#### Defect log — manual signup returned HTTP 500 (9 Sep 2026)

**Symptom.** A manual signup at `http://localhost:3000/sign-up` with a
real external address returned the client's generic
"Something went wrong. Please try again." — the `INTERNAL_ERROR` branch of
`toErrorResponse()`. Reproduced directly:
`POST /api/auth/signup` → **HTTP 500**,
`{"error":{"code":"INTERNAL_ERROR","requestId":"93c67803-…"}}`.

**Root cause 1 of 3 (the one that fired first).** `NEXT_PUBLIC_SUPABASE_ANON_KEY` was present but
**empty** in `vokr/.env.local` — human checklist item 4 below had not been
done. The client schema types it `z.string().optional()`, which accepts
`""`, so boot-time env validation passed and the failure surfaced later:
`requireSupabasePublicConfig()` (`src/server/auth/supabase.ts`) threw
inside `createRouteSupabaseClient()` **before any Supabase call was
made**. Confirmed independently: `GET /auth/v1/settings` against the
linked project with that value returns `401 {"message":"Invalid API
key"}`. The request never reached Supabase Auth, so this was **not** an
Auth-configuration, SMTP, confirmation-requirement or redirect-URL fault.

**Root cause (secondary — why it could not be diagnosed).** *No route
logged anything.* `errors.ts` documents that "the caller is responsible
for the actual logging call; this function only assigns the ID", and no
caller ever made it. The failing request left **zero** entries in
`.next/dev/logs/next-development.log` — the `requestId` in the response
body pointed at nothing. This is why the terminal appeared silent.

**Third defect found while fixing (latent, would have hit R12 directly).**
`src/app/api/auth/signup/route.ts` destructured only `data` from
`supabase.auth.signUp()` and **discarded `error` entirely**. Every
Supabase-side failure — including `unexpected_failure /
"Error sending confirmation email"` when SMTP is not configured — was
converted into **HTTP 200 "a confirmation link is on its way."** That is
verbatim the failure signature §6 calls "the single most dangerous item in
the programme" (`signUp()` succeeds, the email never arrives, no client
error), reproduced by the application itself regardless of SMTP state.

**Fixes applied.**
1. `src/lib/log.ts` (new) — `logServerError(scope, requestId, error)`.
   Expected `AppError`s log one compact `warn`; anything else logs at
   `error` with the full stack and up to three levels of `cause`. Wired
   into every `toErrorResponse()` call site (5 auth routes + 2 catalog
   routes), passing the same `requestId` that reaches the client.
2. `src/server/auth/signup-error.ts` (new) — `classifySignupResult()`.
   Anti-enumeration is preserved but narrowed to the one fact it actually
   requires hiding: `user_already_exists` / `email_exists` still collapse
   into the generic success message. Everything else is now honest —
   `over_email_send_rate_limit` → 429, `weak_password` /
   `email_address_invalid` → 400, and **every other error (SMTP, provider
   disabled, config, outage) → logged 500, never a fake success.** A null
   error with no user is also treated as operational.
3. `src/app/api/auth/signup/route.ts` — consumes the classifier; the
   Supabase `error` is no longer discarded.

**Evidence.** After the logging fix the same request produces, in
`.next/dev/logs/next-development.log`:
`[auth/signup] INTERNAL_ERROR requestId=f7f821fc-… : Error:
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.
at requireSupabasePublicConfig → createRouteSupabaseClient → POST
(src/app/api/auth/signup/route.ts)` — the exact underlying cause, where
previously there was no log line at all.

**Two further causes, found only after the logging fix made them visible.**
The empty anon key was the *first* of three stacked failures — each one
masked the next, which is why the single generic 500 was so opaque.

*Cause 2 — the running dev server was connected to the real Supabase
database, not local Compose Postgres.* With the anon key in place, signup
and sign-in still returned 500. The new log line gave the reason directly:
`PrismaClientKnownRequestError … Raw query failed. Code: 42P01. Message:
relation "rate_limit_counters" does not exist`, thrown from
`consumeRateLimit → assertWithinRateLimit → POST` — the rate limiter runs
*before* the Supabase call in both routes, so it gated signup too.

The table was not missing locally: `prisma migrate status` reported
"Database schema is up to date", `\dt` on the Compose container listed all
seven tables, and a direct `pg` connection using the app's own
`DATABASE_URL` ran `select count(*) from rate_limit_counters` successfully.
The catalog route also worked and returned the expected products — but the
seed hardcodes product ids (`prisma/seed-data.ts`), so matching ids proved
nothing about *which* database was answering.

Confirmed against the real project's PostgREST with the anon key:

| Table | Real Supabase project |
| --- | --- |
| `products` | exists (HTTP 401 `42501` — table present, `anon` lacks SELECT) |
| `rate_limit_counters` | **absent** (HTTP 404 `PGRST205`) |
| `guest_sessions` | **absent** (HTTP 404 `PGRST205`) |
| `app_users` | **absent** (HTTP 404 `PGRST205`) |

That is exactly the observed behaviour — catalog works, rate limiter
throws 42P01 — so the dev server was reading a `DATABASE_URL` exported in
its launching shell, which Next.js gives precedence over `.env.local`.
This is the documented ad-hoc mechanism for one-off `prisma migrate
deploy` / `db seed` runs against the real project (README, and the
`.env.local` comment block); leaving it exported in the shell that then
runs `npm run dev` silently repoints the whole application at production.
**Verified fixed:** the same sign-in request against a clean-environment
production build (`next start -p 3001`, reading only `.env.local`) returns
`401 UNAUTHORIZED "Invalid email or password."` — the rate limiter,
Supabase client construction and the Auth round-trip all succeed.

*Cause 3 — the Phase 3 migration was never deployed to the real Supabase
project.* The table survey above is not only a dev-environment artefact:
`20260908102243_auth_guest_sessions` has been applied to local Compose
Postgres but **not** to `fzjuiocvzqaycchwsjef`, which carries only Phase
2's `init_catalog`. **This is an open production gap, not a local one.**
Deliberately NOT deployed as part of this bug fix — a schema write to the
production database is out of scope for a defect investigation and needs
its own decision. **Action required before Phase 3 can be considered
deployable:** run `prisma migrate deploy` against the real project per the
README's session-pooler instructions, then re-run the table survey above
and confirm all three tables report something other than `PGRST205`.

> **RESOLVED 10 Sep 2026.** That action was carried out exactly as
> specified: `prisma migrate deploy` against the session pooler on port
> 5432, and the table survey re-run — all three tables now report `42501`
> instead of `PGRST205`. The `PGRST205` table immediately above is a
> record of the 9 Sep state and is retained as the defect evidence; it no
> longer describes production. See Phase 3 open item 5 and the §0.2
> evidence log.

**Regression tests.** `src/server/auth/__tests__/signup-error.test.ts`
(11 cases, incl. "reports a failed confirmation-email send as operational,
never as a success") and `src/lib/__tests__/log.test.ts` (4 cases).
`npm run test` **94/94 passed, 15 files** (was 75/75, 13 files).
`npm run lint`, `npm run typecheck` and `npm run build` all clean.

**Status (9 Sep 2026).** The anon key is now written to `.env.local`
(208 chars, from the linked project). Live Auth config read back from
`/auth/v1/settings` on the real project: `email: true`,
`disable_signup: false`, `mailer_autoconfirm: false` — i.e. email signup
enabled and **confirmation required**, the intended launch configuration.
**`google: false` — Google OAuth is still not configured** (human
checklist item 3, still open). Brevo domain verification and custom SMTP
(items 1–2) are reported done by the operator as of this date.

**Three defects fixed; end-to-end signup still NOT verified.** The
remaining blockers are (a) a dev server that must be started from a shell
with no `DATABASE_URL` exported, and (b) the manual external-inbox test
itself, which needs a human inbox. **R12 remains open. Phase 3 remains
incomplete. Phase 4 not started.**

#### Phase 3 verification round 2 — 9 Sep 2026 (post-fix)

With the anon key in place and the dev server started from a shell with no
`DATABASE_URL` export (`env -u DATABASE_URL -u DIRECT_URL npm run dev`), a
real signup was performed by the operator against two external addresses.
The evidence below is read back from the live systems, not inferred.

**1. ✅ Supabase Auth users created and confirmed.** Read from the
project's admin API (`GET /auth/v1/admin/users`; the service-role key was
used transiently in memory and never written to disk or printed):

| field | user A | user B |
| --- | --- | --- |
| id | `cf9a05dc-8b99-4ba6-9406-5b8a8aa8a116` | `b8f70250-0c8b-4d9b-a2ce-280c30bdde8e` |
| email | `cs23b1011@iiitr.ac.in` | `smaranreddy1011@gmail.com` |
| created_at | 09:06:53Z | 09:08:31Z |
| **email_confirmed_at** | **09:07:12Z** | **09:08:45Z** |
| last_sign_in_at | **null** | 09:12:31Z |
| provider | email | email |

**✅ R12 — a confirmation email was delivered to external inboxes via
Brevo.** Both addresses are outside the Supabase project team, on two
unrelated domains (`iiitr.ac.in`, `gmail.com`), and both reached
`email_confirmed_at` — which GoTrue sets only when the emailed link is
actually followed. The mail therefore left Brevo, was accepted by two
independent receiving domains, and the link resolved. **This is the first
real evidence for R12 in the programme.**

**2. ✅ The `app_users` row exists.** From local Postgres:
`b8f70250-0c8b-4d9b-a2ce-280c30bdde8e | smaranreddy1011@gmail.com |
2026-09-09 09:12:31.342+00`. User A has **no** `app_users` row, which is
correct by design rather than a defect: the row is created on the first
*authenticated* request (task 8), and user A confirmed but never signed in.

**3. ❌ The confirmation callback does NOT establish an authenticated
session.** This is a real, reproducible defect, and it blocks an
acceptance criterion.

*Evidence.* User A was confirmed at 09:07:12Z yet still has
`last_sign_in_at: null` and no `app_users` row — a successful callback
would have produced both, since `/api/auth/callback` runs
`completeSignIn()` on success. User B's `app_users` row was written at
09:12:31.342, matching `last_sign_in_at` 09:12:31.128 (the *password
sign-in*), not the confirmation at 09:08:45. Neither confirmation created
a session.

*Root cause.* `/api/auth/callback` calls `exchangeCodeForSession(code)`,
which requires the PKCE **code-verifier cookie written by the browser that
started the signup**. Instrumenting the route surfaces the exact error:

`AuthPKCECodeVerifierMissingError: PKCE code verifier not found in
storage. This can happen if the auth flow was initiated in a different
browser or device, or if the storage was cleared.`

The cookies themselves are set correctly — a signup response carries
`sb-<ref>-auth-token-code-verifier` (plus the per-flow and legacy names)
with `Path=/` and `SameSite=lax` — so the mechanism is sound *within the
originating browser only*. Confirmation links are routinely opened
elsewhere: another browser, a phone, or a mail-provider link scanner. Both
confirmations here landed 19 s and 14 s after signup, which is fast for a
human and consistent with an automated scanner consuming the one-time
token.

*Consequence.* Email confirmation marks the address verified but silently
fails to sign the customer in; they are redirected to
`/sign-in?error=oauth` and must enter their password. **Not fixed here.**
The durable fix is Supabase's documented email-confirmation pattern —
`verifyOtp({ token_hash, type })`, which needs no verifier and works from
any device — and it requires **both** a code change and a Supabase
dashboard email-template change (`{{ .TokenHash }}` in place of
`{{ .ConfirmationURL }}`). Raised as an open item rather than applied
mid-verification.

**Defect fixed during this round — `NEXT_PUBLIC_*` never reached the
browser.** `src/lib/env-client.ts` passed `process.env` wholesale to
`parseEnvSection()`. Next.js inlines a `NEXT_PUBLIC_*` value only where
the source contains a *static* `process.env.NAME` member expression, so
nothing was substituted: a clean production build contained the Supabase
URL and anon key in **zero** `.next/static` files, and the compiled chunk
read `parseEnvSection(schema, process.env, "Client environment")` against
the browser's empty `process` shim. Every client variable was `undefined`
in the browser, so `createSupabaseBrowserClient()` threw
"NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set",
breaking the **Google sign-in button** and the **password-reset form** —
both Phase 3 surfaces. The server half kept working, which is why it went
unnoticed. Fixed by reading each variable as an explicit member expression
into `CLIENT_ENV_SOURCE`. **Verified:** the same grep now finds the URL,
anon key and site URL in the client chunk (1 file each), while all eight
server-secret *names* still return zero matches. Guarded by
`src/lib/__tests__/env-client-inlining.test.ts`, which asserts on the
source text — a runtime test cannot catch this, because under Vitest
`process.env` is fully populated and both the correct and the broken form
pass.

**Observability gap closed — `/api/auth/callback` now logs.** Every
failure path in that route returned a bare redirect to
`/sign-in?error=oauth` with nothing written anywhere, which is precisely
why defect 3 was invisible. All three paths (missing `code`, failed
exchange, unexpected throw) now call `logServerError()` with the cause
chain.

#### Validation run — 9 Sep 2026

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test` | **100 passed, 16 files** (was 75 / 13 at phase code-complete) |
| `npm run test:integration` | **31 passed, 5 files**, against Compose Postgres |
| `npm run build` | clean, 13 routes |
| Bundle secret-name grep | 0 matches for all 8 server-secret names |
| Client public-value inlining | URL / anon key / site URL each present in 1 chunk |

#### Fix — `token_hash` + `verifyOtp` confirmation flow (9 Sep 2026)

Closes the defect recorded in verification round 2: email confirmation
marked the address verified but never signed the customer in.

**What changed.**

- **`src/app/api/auth/confirm/route.ts` (new).** Supabase's documented
  server-side confirmation flow. Reads `token_hash` + `type` from the
  link, calls `supabase.auth.verifyOtp()`, and on success runs the *same*
  `completeSignIn()` the password sign-in and OAuth callback run — guest
  upgrade, guest cookie cleared, `app_users` row created — so a confirmed
  customer arrives with exactly the identity every other authenticated
  path produces. The existing session architecture is reused, not
  bypassed.
- **`src/server/auth/confirm.ts` (new).** `parseConfirmParams()` and
  `safeNextPath()`, kept out of the route file because the Vitest `node`
  project covers `src/server/**` and `src/lib/**`, not `src/app/**` — the
  route itself would otherwise be untestable.
- **`src/app/api/auth/signup/route.ts`.** `emailRedirectTo` now points at
  `/api/auth/confirm`, and builds on `siteConfig.url` rather than the raw
  env var so an unset `NEXT_PUBLIC_SITE_URL` cannot produce a relative
  redirect target.
- **`/api/auth/callback` is unchanged** and still owns the OAuth `?code=`
  exchange, which genuinely is PKCE and genuinely does begin in the same
  browser.

**Why this fixes it.** `exchangeCodeForSession()` needs the PKCE code
verifier cookie belonging to the browser that *started* the signup;
`verifyOtp()` needs nothing from the browser, so confirmation works from a
phone, from webmail, or from any device that is not the one that signed
up.

**Security properties, each covered by a test.**

- **`signup` is the only accepted OTP type.** `recovery` is refused
  specifically: a recovery token legitimately mints a session (that is how
  `/reset-password` works), so accepting it here would land the visitor at
  `next` holding a full session having never set a password — turning any
  reset email into a sign-in. `email_change`, `email`, `magiclink` and
  `invite` are refused as flows this phase does not offer.
- **No open redirect.** `next` must be a single-slash-prefixed path;
  `//evil.example`, `/\evil.example`, absolute URLs and scheme-only values
  all fall back to `/`. A test asserts every accepted value resolves to
  our own origin.
- **No CR/LF** in `next`, so nothing can be injected into the `Location`
  header.
- **`token_hash` is charset- and length-constrained** before it reaches
  Supabase or a log line.
- **Failures are uniform.** Every rejection returns the same
  `/sign-in?error=confirm` redirect; the specific reason goes only to the
  server log, so a forged link learns nothing.

**End-to-end evidence (9 Sep 2026).** Exercised against the running dev
server and the real Supabase project using an admin-generated
`token_hash` (`POST /auth/v1/admin/generate_link`), which produces a
genuine one-time token without sending mail. One throwaway Auth user was
created and deleted again; cleanup was asserted, and the project is back
to its two real test users. **14/14 checks passed:**

| Check | Result |
| --- | --- |
| `GET /api/auth/confirm?token_hash=…&type=signup` | HTTP 307 → `http://localhost:3000/` |
| Session cookie issued | `sb-<ref>-auth-token` present on the redirect |
| `app_users` row created by `completeSignIn()` | yes, matching the Auth user id |
| `email_confirmed_at` set | yes |
| **`last_sign_in_at` set by the confirmation** | **yes — this is the defect fixed** |
| Replay of the same `token_hash` | refused → `?error=confirm` |
| `type=recovery` / `type=email_change` | both refused |
| `next=//evil.example` / `next=https://evil.example` | both refused, no external redirect |
| Missing `type` / malformed `token_hash` | both refused |
| Cleanup (Auth user + `app_users` row) | verified removed |

The contrast with round 2 is the point: there, a confirmed user had
`last_sign_in_at: null` and no `app_users` row. Here the confirmation
alone produces both.

**Validation.** `npm run lint` clean · `npm run typecheck` clean ·
`npm run test` **132 passed, 17 files** · `npm run test:integration`
**31 passed, 5 files**, run 4× consecutively for flake-check ·
`npm run build` clean, and `/api/auth/confirm` registers as a dynamic
route.

**REMAINING — the dashboard step this depends on.** *(Completed 9 Sep
2026 — the template below is in place, and round 3 confirms real emails
now sign the customer in. Retained for the exact markup.)* The endpoint
is live and proven, but the *email* linked to the old PKCE URL until the
**Confirm signup** template was changed (Authentication → Emails):

```html
<h2>Confirm your signup</h2>
<p>Follow this link to confirm your Vokr account:</p>
<p><a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a></p>
```

`{{ .SiteURL }}` is used rather than `{{ .RedirectTo }}` because the
project's `additional_redirect_urls` is empty, so a `RedirectTo` outside
the allow-list would silently fall back to the site URL. Site URL is
currently `http://localhost:3000` and must become the production origin
at deploy.

**`supabase config push` must NOT be used to apply this.** `supabase
config diff` against the project reports 19 differences, and pushing
`config.toml` as it stands would **set `auth.email.enable_confirmations`
from `true` to `false`** — disabling email confirmation in production
outright — as well as reverting `site_url`, `otp_length` (8→6),
`max_frequency` (1m→1s), TOTP MFA, Twilio SMS, storage analytics and the
pooler sizes. The CLI's own help warns that a non-interactive run proceeds
by default. Apply the template by hand in the dashboard.

**Confirmed by the same diff:** Brevo SMTP is live on the project —
`auth.email.smtp.enabled: true`, `host: smtp-relay.brevo.com`,
`port: 587`, `sender_name: Vokr` (credentials masked by the API). That
closes the configuration half of R12 with direct evidence rather than
operator report. Note `auth.rate_limit.email_sent` is reported as
*unmanaged* by the diff and so remains **unverified** — human checklist
item 2's "raise the email rate limit" step still needs confirming in the
dashboard.

**Residual risk, not fixed and not caused by this change.** A mail
provider that pre-fetches links will consume the one-time token before
the customer clicks, leaving them at `?error=confirm`. The round-2
timings (confirmations 19 s and 14 s after signup) are consistent with
exactly that. This affected the previous flow identically. The usual
mitigation is a landing page that requires a human interaction before the
token is spent; that is a UX change beyond this fix and is left as an open
item.

#### Configuration audit — 9 Sep 2026 (read directly from the project)

Read with `supabase config pull --dry-run` (read-only; `config.toml` was
byte-compared before and after and is unchanged) and the project's
PostgREST/admin APIs. These are remote values, not operator report.

| Setting | Remote value | Assessment |
| --- | --- | --- |
| `auth.email.enable_confirmations` | `true` | ✅ confirmation required, as intended |
| `auth.email.smtp.enabled` | `true` | ✅ custom SMTP live |
| `auth.email.smtp.host` / `port` | `smtp-relay.brevo.com` / `587` | ✅ Brevo, credentials masked by the API |
| `auth.email.smtp.sender_name` | `Vokr` | ✅ |
| **`auth.rate_limit.email_sent`** | **`30`** | ❌ **still the 30/hour default — human checklist item 2's "raise it" step is NOT done** |
| `auth.email.max_frequency` | `1m0s` | one email per address per minute — relevant when re-testing |
| `auth.email.otp_length` | `8` | — |
| `auth.site_url` | `http://localhost:3000` | dev value; **must become the production origin at deploy** |
| `auth.additional_redirect_urls` | `[]` (empty) | why the email template uses `{{ .SiteURL }}`, not `{{ .RedirectTo }}` |
| `auth.external.google` | `false` | ❌ Google OAuth still not configured (deferred by instruction) |

**Phase 3 migration status in the real project — still NOT deployed.**
*(Snapshot of 9 Sep 2026. **Superseded 10 Sep 2026 — the migration has
since been deployed;** see the resolution note below this table, Phase 3
open item 5, and the §0.2 evidence log. Retained because the 9 Sep
`PGRST205` readings are the evidence the gap was real.)*
Re-checked via PostgREST with the anon key:

| Table | Real project |
| --- | --- |
| `products` / `product_variants` / `inventory` | present (HTTP 401 `42501` — table exists, `anon` lacks SELECT) |
| `app_users` | **absent** (HTTP 404 `PGRST205`) |
| `guest_sessions` | **absent** (HTTP 404 `PGRST205`) |
| `rate_limit_counters` | **absent** (HTTP 404 `PGRST205`) |

Only Phase 2's `init_catalog` has been deployed. `20260908102243_auth_guest_sessions`
has not. Deliberately left undeployed per the 9 Sep decision to keep
production schema changes out of a defect investigation.

**Update — 10 Sep 2026: deployed.** `20260908102243_auth_guest_sessions`
was applied to `fzjuiocvzqaycchwsjef` under explicit operator approval,
after the pending migration and its exact object list were reviewed
first. `prisma migrate status` reports "Database schema is up to date!",
and every row of the table above that said **absent** now reads
`42501` (present, `anon` denied). The table is left unedited as the 9 Sep
record.

**Password reset carries the same cross-device defect the signup
confirmation just had.** `src/components/auth/reset-password-form.tsx`
calls `supabase.auth.exchangeCodeForSession(code)` **in the browser**, and
the PKCE verifier it needs was written by the server response to
`POST /api/auth/reset` — i.e. it lives only in the browser that submitted
the forgot-password form. A reset link opened anywhere else fails exactly
as signup confirmation did, with the same
`AuthPKCECodeVerifierMissingError`. This is identified by reading the code
and by symmetry with the confirmed signup defect; it is **not yet
empirically confirmed**, and it is **not fixed** — the durable fix is a
recovery route using `verifyOtp({ type: "recovery" })` that establishes
the recovery session server-side and redirects to `/reset-password`,
which is deliberately *not* what `/api/auth/confirm` does (it refuses
`recovery` by design, so that a reset link can never become a plain
sign-in). Raised as an open item.


#### Defect log round 3 — the two reported real-world failures (9 Sep 2026)

Reported after the **Confirm signup** template was repointed at
`/api/auth/confirm`: (a) opening the confirmation link in a separate
private window "does not complete successfully"; (b) the recovery link
lands on `/reset-password` showing "This reset link is invalid or has
expired". Investigated against the live project's Auth records, the local
`app_users` table, the installed `@supabase/auth-js` source, and the
running dev server.

##### Evidence gathered first

Auth user timeline, read from `GET /auth/v1/admin/users` (all five real
users; throwaway test users created during this investigation were
deleted and the final list re-asserted):

| Email | created | confirmation sent | email confirmed | last sign-in | `app_users` row |
| --- | --- | --- | --- | --- | --- |
| `cs23b1011@iiitr.ac.in` | 09:06:53 | 09:06:53 | 09:07:12 | — | no |
| `smaranreddy1011@…` | 09:08:31 | 09:08:31 | 09:08:45 | 09:12:31 | 09:12:31 |
| `smaranreddy007@…` | 09:44:50 | 09:44:50 | 09:45:20 | 09:45:41 | 09:45:20.933 |
| **`smaranreddy777@…`** | 10:23:44 | 10:23:44 | **10:24:00.497** | **10:24:00.509** | **10:24:00.731** |
| **`smaranreddy33@…`** | 10:28:49 | 10:32:04 | **10:32:44.398** | 10:33:43 | **10:32:44.637** |

The two bolded rows are the decisive measurement. For `…777@`,
`email_confirmed_at` and `last_sign_in_at` are **12 ms apart**, and the
`app_users` row lands 234 ms later; for `…33@`, the `app_users` row lands
239 ms after `email_confirmed_at`. Nothing but `/api/auth/confirm` does
those three things in one operation — GoTrue's own `/auth/v1/verify`
confirms an address without signing anyone in, and nothing else in the
system writes `app_users` at confirmation time.

**Conclusion: the `token_hash` + `verifyOtp` confirmation flow works with
real, emailed, PKCE-issued tokens.** The earlier 14/14 harness proved it
with an admin-generated (non-PKCE) token; these two rows prove it with the
genuine article, delivered through Brevo. `verifyOtp()` returned a real
session and `completeSignIn()` ran.

##### Root cause (a) — the confirmation *outcome* is invisible, both ways

The confirmation succeeded server-side, so what failed was the customer's
ability to observe it. Two distinct code defects, both real:

1. **`/sign-in?error=confirm` was never read.** `/api/auth/confirm` and
   `/api/auth/callback` both redirect every failure to
   `/sign-in?error=confirm` / `?error=oauth` and deliberately log the real
   reason server-side only. `src/app/(auth)/sign-in/page.tsx` did not
   accept `searchParams` at all, so a *failed* confirmation rendered a
   bare, unannotated sign-in page. The routes had been written against a
   contract the page never implemented.
2. **A *successful* confirmation is equally silent.** It redirects to `/`,
   and `SiteHeader` contains no authentication affordance whatsoever — no
   account link, no sign-out, no email. Success and failure therefore look
   identical from the browser.

Defect 1 is fixed here. **Defect 2 is deliberately not fixed:** this plan
already assigns account affordances in `SiteHeader` to **Phase 4** (§5
Phase 3, task 9 says so explicitly), and building them now would be
starting Phase 4. It is carried as an open item instead, with the
consequence stated plainly: until Phase 4 lands, a signed-in customer
cannot tell they are signed in, so "did the confirmation work?" cannot be
answered from the UI — only from the cookie jar or the database.

**Not established, and stated as such:** which of the two the reporter
actually hit. Both recent confirmations succeeded server-side, so the
failed click was either an older link from an earlier test whose token was
already spent (which now renders a bare sign-in page — defect 1), or a
success the UI could not show (defect 2). Auth timestamps cannot
distinguish them, and the dev-server log for that click was not captured.
Re-testing after these fixes will distinguish them, because a failure now
says so on the page.

##### Root cause (b) — password reset was genuinely broken, cross-browser

This one is a real functional defect and is fixed.

`src/components/auth/reset-password-form.tsx` called
`supabase.auth.exchangeCodeForSession(code)` **in the browser**. That
requires the PKCE code-verifier cookie, and the verifier is written by the
response to `POST /api/auth/reset` — confirmed directly by probing the
route, which sets `sb-<ref>-auth-token-code-verifier`,
`…-auth-token-flow-<id>-code-verifier` and `…-auth-token-flows-code-verifier`
(`Path=/`, `SameSite=lax`, no `HttpOnly`). Those cookies exist **only in
the browser that submitted the forgot-password form.** Any other
browser — a private window, a second browser, a phone, webmail — has no
verifier, the exchange fails, and the component falls into its
`linkError` branch: *"This reset link is invalid or has expired."*
Exactly the reported symptom, and deterministic rather than intermittent.

Corroborated by the Auth record for `smaranreddy33@`: `recovery_sent_at`
10:33:30 and `last_sign_in_at` 10:33:43. GoTrue's `/auth/v1/verify`
**did** accept the token and mint a session 13 s later — the link was
valid and was redeemed successfully. Only the browser-side exchange
failed. The message was reporting the wrong thing entirely.

**Ruled out along the way,** each by direct measurement rather than
inference: the verifier cookies are not `HttpOnly`, so JS can read them;
`redirect_to` is accepted (GoTrue matches the Site URL's hostname, which
is why the page rendered at all despite `additional_redirect_urls` being
empty); and `auth-js` 2.116.0 dual-writes the legacy fixed verifier key
and appends `sb_flow_id` to the redirect, so multi-flow slot selection is
not the failure either.

##### Fix — server-side `verifyOtp({ type: "recovery" })`

The mirror of the signup confirmation fix, and for the same reason:
`verifyOtp()` needs nothing from the browser.

- **`src/app/api/auth/reset/confirm/route.ts` (new).** Redeems
  `?token_hash=…&type=recovery`, establishes the recovery session as
  cookies on the redirect, and sends the customer to `/reset-password`.
- **`src/server/auth/recovery.ts` (new).** `parseRecoveryParams()`, kept
  out of the route file so the Vitest `node` project can cover it.
- **`src/server/auth/otp-link.ts` (new).** The `token_hash` charset/length
  check, now shared by both link endpoints instead of duplicated.
- **`src/components/auth/reset-password-form.tsx`.** No longer exchanges a
  code; it checks for the session the server established and collects the
  new password. `updateUser()` stays client-side exactly as before —
  `@supabase/ssr` does not mark session cookies `HttpOnly`, so the browser
  client reads the server-established session from `document.cookie`. On
  success it now signs out before redirecting to `/sign-in`, so a session
  minted from an emailed link does not outlive the reset it was issued for.
- **`src/app/api/auth/reset/route.ts`.** `redirectTo` repointed at the new
  route and built on `siteConfig.url` rather than
  `clientEnv.NEXT_PUBLIC_SITE_URL ?? ""`, which could produce a relative
  redirect target if the variable were unset.
- **`src/app/(auth)/sign-in/page.tsx` + `src/lib/auth-error-messages.ts`
  (new).** Surfaces `?error=confirm` / `?error=oauth`. Unrecognised codes
  render nothing rather than being echoed — the value comes from the URL,
  and rendering arbitrary text on our own sign-in page is a phishing
  primitive. Backed by a `Map`, not an object literal, so `constructor`
  and `__proto__` cannot resolve to something inherited from
  `Object.prototype`; there is a test for precisely that.

**Security properties, each covered by a test.**

- **`recovery` is the only accepted type**, the exact mirror of
  `/api/auth/confirm` refusing `recovery`. Keeping the endpoints separate
  is what pins the destination: a recovery token always lands on
  `/reset-password`, which demands a new password before anything else,
  and a `signup` token can never be redeemed to reach that page.
- **No `next` parameter at all.** A recovery token mints a real session,
  so a caller-chosen destination would be an open redirect that arrives
  authenticated. The destination is a compile-time constant.
- **`completeSignIn()` is deliberately not run here.** This is not a
  "guest becomes a customer" event; merging a guest cart and rotating the
  guest cookie on the strength of an emailed link would let anything that
  touches that link — a stale inbox, a mail scanner — destroy a live guest
  session. The upgrade runs when the customer signs in with the new
  password.
- **Uniform failures.** Every rejection redirects to
  `/reset-password?error=link`; the reason goes only to the server log.
  The `error=link` marker is trusted over the session check, so a visitor
  who happens to hold a session is never shown a password form off a link
  that failed.

**End-to-end evidence (9 Sep 2026).** Exercised against the running dev
server and the real Supabase project with a genuine recovery token from
`POST /auth/v1/admin/generate_link`, **redeemed with no cookies at all** —
which is precisely the cross-browser condition that was broken. One
throwaway user created and deleted; cleanup asserted. **11/11 passed:**

| Check | Result |
| --- | --- |
| `GET /api/auth/reset/confirm?token_hash=…&type=recovery`, cold cookie jar | HTTP 307 → `/reset-password` |
| Recovery session cookie issued | `sb-<ref>-auth-token` present |
| **Session actually authorises `updateUser({password})`** | **yes** |
| **New password signs in via `/api/auth/signin`** | **HTTP 200** |
| Replay of the spent token | refused → `?error=link` |
| `type=signup` redeemed here | refused |
| Missing `type` / malformed `token_hash` | both refused |
| `next=https://evil.example` | ignored, no external redirect |
| Cleanup (Auth user + `app_users` row) | verified removed |

**Validation.** `npm run lint` clean · `npm run typecheck` clean ·
`npm run test` **164 passed, 19 files** (was 132/17; +32 for
`recovery.test.ts` and `auth-error-messages.test.ts`) ·
`npm run test:integration` **31 passed, 5 files** · `npm run build` clean,
with `/api/auth/reset/confirm` registering as a dynamic route.

**REMAINING — the dashboard step this depends on.** *(✅ **DONE —
confirmed 10 Sep 2026.** The template below is in place: a real recovery
email was delivered through Brevo, its link opened in a separate private
browser, reached the *Set a new password* form, and the new password
signed in. Retained for the exact markup and for the production-origin
note at the end.)* As with the signup
fix, the endpoint is live and proven but the *email* still links to the
old PKCE URL until the **Reset Password** template is changed
(Authentication → Emails):

```html
<h2>Reset your password</h2>
<p>Follow this link to set a new Vokr password:</p>
<p><a href="{{ .SiteURL }}/api/auth/reset/confirm?token_hash={{ .TokenHash }}&type=recovery">Set a new password</a></p>
```

`{{ .SiteURL }}` rather than `{{ .RedirectTo }}` for the same reason as
the signup template: `additional_redirect_urls` is empty, so a
`RedirectTo` outside the allow-list silently falls back to the site URL.
Site URL is `http://localhost:3000` today and must become the production
origin at deploy. **`supabase config push` must still not be used** — it
would set `auth.email.enable_confirmations` from `true` to `false`.


#### Validation run — 10 Sep 2026 (Phase 3 closure)

Run after the production migration and the real-world password-reset
verification, with the dev server on local Compose Postgres.

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean (`next typegen` → route types generated, `tsc --noEmit` clean) |
| `npm run test` | **189 passed, 21 files** (was 164 / 19 at round 3; +9 for `anti-enumeration.test.ts`) |
| `npm run test:integration` | **37 passed, 6 files**, against Compose Postgres (+6 for `client-ip-bucketing.integration.test.ts`) |
| `npm run build` | clean, from a deleted `.next` (the dev server was stopped first). 16 static pages generated. |
| **`npm run verify` (full gate)** | **exit 0** — lint + typecheck + test + build |
| Bundle secret-name grep | **0 matches** for all 8 server-secret names in `.next/static`; local DB password literal also 0 |
| Client public-value inlining | Supabase URL / anon key / site URL each present in exactly 1 chunk |
| `prisma migrate status` (production) | "Database schema is up to date!" |
| Real password reset, cross-browser | ✅ passed — see §0.2 evidence row |

#### Phase 3 open items as of 9 Sep 2026 (round 3)

1. **Signup confirmation — code FIXED and now proven with real emails.**
   Two real Brevo-delivered PKCE links confirmed *and* signed in through
   `/api/auth/confirm` (see round 3 evidence table). The **Confirm
   signup** template is in place. No longer an open defect.
2. ✅ **CLOSED (10 Sep 2026) — password reset verified end-to-end with a
   real Brevo-delivered email, cross-browser.** The **Reset Password**
   template is confirmed repointed at `/api/auth/reset/confirm`, and one
   fresh real-world reset was performed against `smaranreddy1011@gmail.com`:
   requested in the normal browser, the emailed link **opened in a separate
   Incognito/private window**, which reached the *Set a new password* form;
   the new password was set and then successfully used to sign in.
   **That cross-browser hop is the exact condition round 3 proved broken**
   (`AuthPKCECodeVerifierMissingError` — the verifier cookie existed only
   in the requesting browser). It now succeeds, so the server-side
   `verifyOtp({type:"recovery"})` fix is confirmed against a genuine
   PKCE-issued, Brevo-delivered token rather than only an admin-generated
   one. Full evidence: §0.2 evidence log, row "3 — password reset
   (real-world, cross-browser)".
3. **No authentication affordance in the UI — Phase 4, and it blocks
   verification today.** `SiteHeader` shows no signed-in state, so a
   successful confirmation and a failed one are visually identical from
   the browser; a signed-in customer cannot tell they are signed in, and
   there is no sign-out. This plan assigns account affordances to Phase 4
   (§5 Phase 3, task 9), so it is *not* built here. Consequence to accept
   consciously: until Phase 4, "did it work?" is answerable only from the
   cookie jar or the database, not by looking at the site.
4. **Google OAuth — DEFERRED to Phase 4 (task 14), 10 Sep 2026.**
   Recorded under §12 Definition-of-Done item 1: "explicitly deferred with
   a recorded reason and a new task in a later phase." **Reason:** deferred
   by operator instruction during Phase 3 closure; it requires a Google
   Cloud OAuth 2.0 client (consent screen + credentials) that does not
   exist yet, and it is a console/dashboard action rather than code.
   **Evidence it is still unconfigured:** `/auth/v1/settings` on
   `fzjuiocvzqaycchwsjef` reports `"google": false` — re-read live on
   10 Sep 2026, unchanged from 9 Sep. **Resumes at:** Phase 4 task 14,
   with the production redirect URL added at Phase 20 task 12. Phase 4 is
   the resume point rather than Phase 20 because Phase 4 owns the account
   affordances in `SiteHeader` and its own task 10 forbids shipping a form
   or affordance that does not reach a real endpoint — a Google button
   that cannot work is exactly that, so it must be resolved in the phase
   that would otherwise ship it dead. **Consequence accepted:** the Google
   half of the Acceptance Criteria is deferred, not met, and the Google
   button cannot be tested until Phase 4 task 14 is done.
5. ✅ **CLOSED (10 Sep 2026) — the Phase 3 migration is now deployed to
   the real Supabase project.** `20260908102243_auth_guest_sessions` was
   applied to `fzjuiocvzqaycchwsjef` via `prisma migrate deploy` against
   the session pooler (port 5432), per the README procedure; `supabase
   config push` was not used and no Auth/SMTP/pooler/storage setting was
   touched. `prisma migrate status` now reports **"Database schema is up
   to date!"** (exit 0), and all three tables have flipped from
   `PGRST205` to `42501` on the anon-key survey — present, with `anon`
   still correctly denied SELECT. Phase 2 data is intact (5 products, 27
   variants, 27 inventory rows) and GST/HSN remain `NULL` on all five
   products with all 27 variants still `draft`. Full object-level
   evidence: §0.2 evidence log, row "3 — production migration".
6. ✅ **CLOSED (10 Sep 2026) — anti-enumeration now has an automated
   test.** `src/server/auth/__tests__/anti-enumeration.test.ts` (9 cases).
   The gap persisted because a route-level test would need real Supabase
   Auth responses this environment cannot reach — but that argument
   applies to the *routes*, not to `classifySignupResult()` /
   `classifyResetResult()`, which are what actually choose the
   caller-visible outcome. The test feeds them the error shapes GoTrue
   really returns for registered and unregistered addresses and asserts
   the **caller-visible projection** (status + message) is identical,
   rather than asserting `outcome.kind` equality — which would wrongly
   fail on reset, where `silent-failure` and `generic-success` differ
   internally but are indistinguishable to the caller by design. Covers
   `user_already_exists`, `email_exists`, the confirmations-on duplicate
   shape (a user with empty `identities` and no error), and — the
   sharpest oracle in the phase — GoTrue's recovery cooldown, which is
   keyed on `recovery_sent_at` and therefore reachable *only* for a
   registered address. Two counter-tests assert the rule is not
   over-applied: an SMTP failure on either route must still fail loudly,
   never collapse into a fake success (R12's signature).
7. ✅ **CLOSED (10 Sep 2026) by decision, not by change — see §0.3 D4.**
   `auth.rate_limit.email_sent` **stays at 30/hour**, deliberately.
   Neither this plan nor the PDF ever specified a target above the
   default; both say only "raise it". The binding external constraint is
   Brevo's free allowance of **300 emails/day**, which is ≈**12.5/hour
   sustained** — so **30/hour is already more than double the
   sustainable daily rate**, and raising it would only let one bad hour
   consume a larger share of the day's budget and silently stop order
   confirmations. Human checklist item 2's "raise it" step is therefore
   **resolved as: no change required at launch.** Revisit if Brevo is
   upgraded past the free tier (Phase 11 already pre-authorises one month
   of Brevo Starter at $9) or if the 200/day alert fires. **The Supabase
   setting was not modified.**
8. ⚠️ **DECIDED (10 Sep 2026) — risk accepted for launch, current
   behaviour retained; no UX change made.** A mail provider that
   pre-fetches links can spend either one-time token before the customer
   clicks, leaving them at `?error=confirm` / `?error=link`.
   **Decision: accept and do not change the flow now.** Reasons, stated
   so the next reader can re-open it on evidence rather than taste:
   (a) the failure is **visible, not silent** — round 3 wired both
   `/sign-in` and `/reset-password` to render the error code, so an
   affected customer is told the link did not work and can request
   another, which is the difference between an annoyance and R12's
   silent-failure class; (b) it is **recoverable without support** —
   requesting a fresh link is one click, subject only to the `1m0s`
   `max_frequency`; (c) the standard mitigation is an **interstitial
   landing page requiring a human interaction before the token is
   spent**, which is a visible-content change to an auth surface and
   therefore belongs to the phase that owns those surfaces (**Phase 4**,
   which builds the account affordances), not to a phase closing on
   schema and server routes; (d) **no real customer has hit it** — the
   round-2 timings (confirmations 19 s and 14 s after signup) are
   *consistent with* a scanner but were never isolated, and today's
   cross-browser reset succeeded on the first click. **Re-open if:** any
   real customer reports a first-click failure, or the sign-in/reset
   error rate becomes measurable once Phase 15 observability lands.
   **Carried as a Phase 4 consideration, not a Phase 3 blocker.**

**Phase 3 status: READY TO CLOSE — every acceptance criterion and Exit
Criterion is met or explicitly deferred under §12 item 1; the one
unsatisfied DoD item is item 10, the scoped commit, which has not been
made yet.** §0.1's checkbox stays unticked until it has. Deferred, each
with a recorded reason and a named later-phase task: **Google OAuth** →
Phase 4 task 14 (§12 item 1); **Sentry error reporting** (DoD item 6) →
Phase 15, which is the phase that introduces Sentry — this phase's
observability is `logServerError()` with a request ID on every
`toErrorResponse()` call site; **Secret Manager** (DoD item 7) → Phase 20,
which introduces GCP — this phase's variables are in `env.ts` and
`.env.example`; **email-change flow** (task 9) → Phase 4, which builds the
account page it would need an entry point on; **account affordances in
`SiteHeader`** (open item 3) → Phase 4, assigned there by this plan from
the outset. DoD item 8's "tested against a copy of production data" is
satisfied in substance rather than by drill: the migration is expand-only
and writes zero rows to existing tables, and it was applied to local
Compose Postgres carrying the same seed before production — stated
plainly rather than claimed as a restore-style rehearsal.

*(Historical note, retained: the paragraph below was written when the
phase was genuinely incomplete.)*
Item 2's dashboard step previously meant no *real* recovery email had
completed the fixed flow, which is an acceptance
criterion — **that criterion is now MET: item 2 is CLOSED as of
10 Sep 2026**, a real Brevo recovery email having completed the fixed flow
cross-browser. Item 4 is formally deferred to Phase 4 and **item 5 is
CLOSED** (the production migration is deployed and verified). **The only
substantive items still open are 6, 7 and 8** — the anti-enumeration
test, the un-raised `auth.rate_limit.email_sent`, and the link-prefetch UX
decision. R12's email-delivery and
SMTP-configuration halves are both evidenced directly, and its
sign-in-on-confirmation half is now evidenced by **real delivered emails**
rather than only an admin-generated token — that is the one criterion
round 3 upgraded from inferred to observed.


#### Validation
Sign up with a personal address unconnected to the Supabase project.
Receive the email. Reset the password. Sign in with Google. Confirm the
service-role key appears in zero client chunks (`grep` the build output).

**Performed here:** the `grep` step (zero matches, see evidence log). **Not
performed here** (needs the human checklist below first): signup with a
real external address, receiving the email, Google sign-in.

#### Acceptance Criteria
- ⛔ A real customer can create an account and **receive the email** — blocked, see Exit Criteria.
- ⏸️ **Sign in with Google — DEFERRED to Phase 4 (task 14), 10 Sep 2026.** Not met and not attempted; deferred by operator instruction under §12 item 1. `/auth/v1/settings` reports `"google": false`. See Phase 3 open item 4 for the recorded reason and the resume point.
- ✅ Guest browsing works with no account — `getSession()` mints a guest session lazily on first use, integration-tested.
- ✅ Guest → authenticated transition preserves identity and rotates the token — integration-tested end-to-end through `completeSignIn()`.
- ✅ Auth endpoints are rate limited — integration-tested against real Postgres, including the concurrent-request race.

#### Production Checklist Mapping
**R12** (Brevo custom SMTP — the highest-risk item) — **not closed**.
**R13** (auth rate limit + client IP) — this app's own rate limiting is
built and tested; the Supabase-side email rate limit still needs raising
in the dashboard (task 2). Part of **R19** (rate limiting) — closed for
the auth surface.

#### Dependencies
Brevo account, verified domain, Google OAuth credentials — **none
present in this environment.**

#### Exit Criteria
**A signup confirmation email has arrived in an inbox that is not on the
Supabase project team.** Nothing less closes R12. ✅ **MET — 9 Sep 2026,
re-confirmed in the 10 Sep reconciliation.** Five real accounts were
created through Brevo-delivered mail to addresses outside the Supabase
project team, on two unrelated domains (`iiitr.ac.in`, `gmail.com`); two
reached `email_confirmed_at`, which GoTrue sets only when the emailed link
is actually followed, and `/api/auth/confirm` signed them in with the
`app_users` row written in the same operation (12 ms between
`email_confirmed_at` and `last_sign_in_at`). See "Defect log round 3" for
the timeline read from the project's admin API.

*This entry previously read "NOT MET". That was accurate when written and
stale by the end of round 3 — the evidence had been gathered but the exit
criterion was never reconciled against it. Corrected 10 Sep 2026.*

**A second manual verification, not originally listed but required by the
same principle**, is also met: a real Brevo-delivered *recovery* email
completed the fixed password-reset flow **cross-browser** on 10 Sep 2026
(requested in one browser, link opened in a private window) — the exact
condition round 3 proved broken. See §0.2.

##### Human checklist to close this phase
In order, each blocking the next:
1. Create (or use an existing) Brevo account; verify a sending domain and
   publish its SPF/DKIM/DMARC records on `vokr.shop`. **IN PROGRESS
   (8 Sep 2026):** the records have been added in **Hostinger** (§3.7),
   which is where `vokr.shop` DNS is managed. Brevo's own verification is
   **still pending** propagation — this step is not complete until Brevo
   reports the domain verified. Do not disturb the existing Zoho Mail
   records; SPF must remain a single merged TXT record covering both Zoho
   and Brevo.
2. In the Supabase dashboard (Authentication → Providers): enable
   Email/Password. In Authentication → Emails / SMTP settings: configure
   Brevo as the custom SMTP provider. Raise the email-send rate limit from
   its 30/hour default.
3. ⏸️ **DEFERRED to Phase 4 task 14 (10 Sep 2026) — do not do this now.**
   Create a Google Cloud OAuth 2.0 client (consent screen + credentials);
   enter the client ID/secret into the Supabase dashboard's Google
   provider settings; add the dev/staging/production redirect URLs
   (`<site-url>/api/auth/callback`). Deferred by operator instruction; it
   therefore no longer blocks item 4 or item 5 below, and no longer blocks
   this phase's closure. Recorded under §12 item 1 — see Phase 3 open
   item 4.
4. Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local` (from the Supabase
   dashboard, Settings → API) — everything else needed is already in
   place. **STILL NOT DONE as of 9 Sep 2026: the key is present but
   empty, which is the direct cause of the HTTP 500 on `/sign-up` (see
   Defect log above). This is the first thing to fix, but on its own it
   only gets signup as far as Supabase — items 1–2 still gate the email
   actually arriving.**
5. Sign up with a personal email address that is **not** on the Supabase
   project team, via `/sign-up`. Confirm the email arrives, screenshot it.
   Sign in with Google via the same form's button. Both together close R12
   and the Google half of the Acceptance Criteria.
6. Only then: update this section's Status to **COMPLETE**, check the
   Phase 3 box in §0.1, and append the manual-verification evidence
   (screenshot reference, date) to §0.2.

---

### PHASE 4 — Website / Page Migration

#### Status
**CLOSED — 12 Sep 2026.** All 26 legacy pages (21 marketing/support/legal
pages that migrate 1:1, plus the 5 launch PDPs served by one dynamic
template — `gift-cards.html` excluded per D1) are implemented as Next.js
routes on branch `phase-4-website-migration`, reusing the Phase 2 catalog
and Phase 3 auth. Every Exit Criterion is met or explicitly, correctly
deferred with a recorded reason — see the closure checklist at the end of
this Status block. Evidence: §0.2 Phase 4 rows.

**Implementation tasks 1–6, 10, 11, 12, 13 are done.** Tasks 7, 8 and 9
(🔒) are **correctly withheld** — R14 and R20 remain exactly as the
legacy left them (`terms.html` still reads "email/SMS"; the 10 fabricated
reviews, the "4.7" average and "4,059 reviews" are all still present,
unedited, in `config/reviews-data.ts` and `reviews-summary.tsx`, with a
doc comment explaining why). **Task 9's audit list is compiled below**,
ready for the manager to work through item by item — nothing in it has
been removed or altered.

**Task 14 (Google OAuth) is not configured** — it requires a human with
access to the Google Cloud Console and the Supabase dashboard, neither of
which exists in this environment. Same shape as Phase 3's R12/Brevo
blocker: the code side is done (`SiteHeader`'s account icon links to the
real `/sign-in` built in Phase 3; nothing links to a Google button that
isn't wired up, satisfying task 10's "no dead affordance" for this case),
the configuration side is a recorded resume point, not a code task.

**The 5 PDP routes are now verified end-to-end — 11 Sep 2026.** This
sandbox still cannot reach the real Supabase project (`ECONNREFUSED` on
every `prisma.product.findMany()` call, reconfirmed today), but per this
session's brief — validate against *any* currently configured reachable
database without changing production architecture — the project's own
documented local-dev path (`docker-compose.yml`, already established in
Phase 1) was used instead: Docker Desktop was started, a disposable
`postgres:17-alpine` container was run on an available host port (55432
is inside a Windows/Hyper-V dynamic port-exclusion range on this machine
and could not be bound — a host networking quirk, not a project issue;
15432 was used for this one-off run instead of editing
`docker-compose.yml`), `prisma migrate deploy` applied both existing
migrations, and `prisma db seed` loaded the real 5-SKU/27-variant catalog
— the same seed `npm run db:seed` always produces, not synthetic test
data. Against that database: **all 26 routes** (not 21) pass
`e2e/phase4-fidelity.spec.ts` and `e2e/phase4-routes.spec.ts` (route-200,
§2A.7 fidelity, zero-serious axe) in one clean run each; `npm run build`
now prerenders all 5 `/shop/*` slugs as static pages instead of falling
back, proving both code paths (DB reachable → SSG; DB unreachable →
on-demand fallback, §0.2) work. **Two real defects were found and fixed
by this verification pass, not invented to justify it:** the size grid
showed a bare `S/M`/`One Size` instead of the legacy's `IN S/M`/`IN One
Size` for socks and laces (the seed data only bakes the `IN ` prefix into
adult/kids shoe sizes; `pdp-purchase-panel.tsx` now normalises it for
every product), and the §2A.7 harness's superset check for JS-injected
review cards (`reviews.html`, every PDP) only worked by accident for
`/reviews` — it happened to have no legacy text *after* the JS-injection
point — and broke for real once a PDP's trailing "See all 4,059 reviews
→" link exposed it; `extract.ts` now marks the injection point with a
sentinel and verifies every legacy segment around it in order, rather
than requiring one unbroken substring. The temporary container and
`.next` build output were removed after verification; nothing about the
real Supabase project, `docker-compose.yml`, or `.env.local` was
touched. See §0.2 for the full evidence and `e2e/fidelity/extract.ts` /
`e2e/phase4-fidelity.spec.ts` for the harness.

**D5 RESOLVED — 12 Sep 2026: manager approved option B for all four
controls (§0.3, §2A.6).** The header cart/Bag button, the PDP "Add to
Cart" button, the Order Status tracking form and the reviews "Write a
Review" button **remain visible and inert through the rest of Phase 4**,
as an explicit, documented exception to task 10's "real endpoint or
removed" binary — not removed, not hidden, not redesigned, given no
fabricated backend. Each expires when its owning later phase ships the
real capability: cart/Bag and Add to Cart at Phase 5–7 close; Order
Status at Phase 9 close; Write a Review at Phase 9 close, additionally
gated on R20 (task 8) separately. Registered as its own §2A.6 row —
content-neutral (pixel-identical to the approved legacy), so it does not
touch §2A.7 fidelity.

**Reviews "Filters" and "Sort" were never part of this exception — now
implemented for real, 12 Sep 2026.** `reviews-list.tsx` is a new client
component: **Sort** reproduces `reviews.html`'s own `rrSortSelect` logic
exactly (Highest/Lowest Rated by `rating`, Most Helpful by `helpful`,
Most Recent = the legacy's own already-most-recent-first order) —
verified by direct inspection (Priyanka M./Karan K./Aditya R./Leon/…
in `helpful`-descending order; Neha J./Ritika S./Sneha K./… in
`rating`-ascending order — exact matches). **Filters** reproduces the
legacy's `rrFilterBtn` capability (filter to one exact star rating,
clearable) through an accessible inline control instead of its
`window.prompt()` — same capability, an implementation choice, not a
content change — confirmed narrowing 10 reviews to the 1 real 3★ review
and updating the button label to "☰ Filters (3★)" exactly as the legacy
did. Neither touches the still-fabricated "{total} reviews" `.rr-count`
line (pending R20), which `reviews-list.tsx`'s own doc comment makes
explicit; a filtered view adds a separate, new "Showing N of M" line
instead. **"Write a Review" stays part of the D5 exception**, inert,
unchanged. All 21/21 previously-passing §2A.7 checks still pass
unchanged (Filters/Sort's visible label text — "☰ Filters", "Sort",
the four option names — was never altered, only made real), confirming
no content moved.

**With D5 resolved and Filters/Sort real, the Exit Criterion "no inert
form" is closed**: three of the four originally-flagged controls
(header cart/Bag, PDP Add to Cart, Order Status) are an explicit,
manager-approved, time-boxed exception (D5); "Write a Review" is the
same exception; Filters and Sort are now genuinely functional. Nothing
in this phase remains silently inert the way the legacy's
`onsubmit="return false"` was.

**Phase 4 closure checklist — every Exit Criterion:**
- Same sections/order/words/navigation/product presentation — ✅ §2A.7, all 26/26 pages, this session and 11 Sep.
- No inert form — ✅ closed via D5 (above); nothing silent or unexplained.
- No unapproved change — ✅ tasks 7/8/9 untouched; D5 is an approved exception, not an unapproved one.
- §2A.7 comparison evidence on file for all 26 pages — ✅ text/structural diff (all 26, twice), axe (all 26), **and now responsive screenshots at 360/768/1024/1440 px for all 26 routes** (104/104 captured, `e2e/phase4-responsive.spec.ts`, 12 Sep 2026 — not run for all 26 in the 11 Sep pass, only proven on the homepage then).
- Legacy source files untouched — ✅ `index (7).html` MD5 `82aa900609d7bae122064c87925308b4`, reverified 12 Sep 2026; `vokr-production.zip` clean.
- R14/R20-conditioned Acceptance Criteria — waived per their own explicit conditional language (§2A.6); remain open, correctly, not blocking closure.
- `robots.txt`/`sitemap.xml` — ✅ generated from real routes.

Tasks 7/8/9 (§2A.6, manager approval) and task 14 (Google OAuth,
external dashboard access) remain open **as recorded, deferred items**,
not phase-closure blockers — the same treatment the plan already gives
R12/OAuth-type external dependencies (Phase 3 precedent). **Phase 5 has
not been started.**

**Task-9 candidate list — unverifiable marketing claims found during
migration, for the manager to approve or reject item by item (§2A.6):**

| Where | Claim | Notes |
|---|---|---|
| Homepage testimonials, `why-vokr`, `community` | "250,000+ customers love their Vokr" / "250,000+ people, one shoe they actually reach for every day" | Same unverified figure repeated across 3 pages |
| `blog` | "What 250,000 pairs of feet taught us about fit" (post title) | Same figure again, a 4th occurrence |
| `about-vokr` stat row | "250K+ Happy customers", "4.7/5 Average rating" | The 4.7 matches the fabricated review average (R20) |
| Homepage, all 5 PDPs, `/reviews` | 10 fabricated reviews, "4.7" average, "4,059 reviews", star/percentage breakdown | **This is R20 itself** (task 8), not a new item — listed here only for completeness |
| Homepage testimonials, `why-vokr`, `community` | Named individuals with real-sounding employers ("VP Product, Razorpay", "Partner, Sequoia India", "Head of Design, Swiggy", "Engineering Manager, Google India") attributed to fabricated social-media posts, duplicated verbatim across pages | Flagged as the **highest-risk item on this list** — this is closer to impersonating identifiable people at named real companies than generic marketing puffery, and duplicating the same quotes across 3 pages compounds it |
| Homepage press strip | Quote "The most thoughtfully designed sneakers ever." attributed to no named source, alongside outlet names "Verve", "Man's World", "Humans of Bombay" with no citation | Unverifiable "as seen in"-style claim |
| `technology` | "...which is exactly how most of our customers wear them" | Unverified customer-behaviour claim |

None of these have been touched. They are exactly as the legacy left
them, per §2A.4 — this table exists so task 9 has a starting point rather
than requiring someone to re-read all 26 pages to find them again.

#### Objective
Migrate the 27 legacy pages into shared Next.js layouts and components,
removing ~2 MB of duplication, every dead form and every piece of
fabricated content.

#### Why It Exists
The duplication has *already* caused a defe
ct — the search index drifted
because it was copy-pasted 27 times. One deployable removes that entire
class of bug and eliminates the CORS and cookie-domain problems a separate
static frontend would create. It also closes **R20**, which is legal
exposure before it is engineering.

#### Governing Constraint — §2A applies in full
**This is the phase §2A was written for.** Before any task below is
started, re-read §2A.4. In summary:

- The approved legacy **layout structure, sections, wording, navigation,
  product presentation, legal copy and information architecture must be
  reproduced faithfully.** Change the implementation underneath, not what
  the visitor sees.
- The homepage source of truth is `index (7).html` (§2A.1/§2A.8); the other
  25 pages come from `vokr-production.zip`. **Inspect the original before
  writing the route.** Neither file may be edited (§2A.3, §2A.5).
- Tasks 7, 8 and 9 below change approved visible or legal content. They are
  registered in §2A.6 as **PENDING MANAGER APPROVAL** and may not be
  implemented until that approval is given — even though this plan
  recommends them and R14/R20 depend on them.
- Each migrated page ships with the §2A.7 comparison evidence (text diff,
  structural diff, snapshot tests, responsive screenshots).

#### Prerequisites
Phase 2 (catalog data), Phase 3 (auth UI has somewhere to live).
**Plus: manager decisions on the §2A.6 pending rows before tasks 7–9 run.**

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
**Any redesign, restructuring, rewording or "improvement" of the approved
legacy pages (§2A.4).** **Any modification to the legacy source files
themselves (§2A.3, §2A.5).**

#### Implementation Tasks
*Tasks marked 🔒 change approved visible or legal content and are gated on
manager approval per §2A.6. Every other task is implementation-only and
must leave the rendered page indistinguishable from the legacy original.*

1. Inventory the 27 legacy pages; classify as marketing / product / support / legal; map each to a route. Exclude `gift-cards.html` (D1) — 26 pages migrate. **Record the section and heading order of each original first — it is the §2A.7 baseline.**
2. Extract the shared CSS into the Tailwind theme in `globals.css`. One source of truth for colour, type scale and spacing. **The visual result must match the legacy rendering; this is a deduplication, not a restyle.**
3. Build the real `SiteHeader` (navigation, search entry point, account and cart affordances) and `SiteFooter` (five `@vokr.shop` addresses). **Navigation structure, link order and labels are reproduced from the legacy markup unchanged (§2A.4) — the only permitted difference is D1's removal of the gift-card link.**
4. Migrate marketing pages as Server Components. Static by default. **Section order, headings and body copy verbatim.**
5. Migrate the 5 launch PDPs to a single dynamic `app/shop/[slug]/page.tsx` driven by the Phase 2 catalog. **One template, five products** — replacing five near-identical HTML files. `gift-cards.html` is not one of them (D1). **Product presentation — gallery, colourway/size controls, copy blocks, their order — is preserved as approved.**
6. Migrate the support and legal pages, **preserving the legal text verbatim.** Any amendment is a 🔒 task, not a judgement call made while migrating.
7. 🔒 **R14 — PENDING APPROVAL (§2A.6): amend the "order confirmation email/SMS" wording in `terms.html` to "email".** SMS is deferred; leaving the copy is a contractual mismatch on day one. **Legal copy — do not apply until a manager approves.**
8. 🔒 **R20 — PENDING APPROVAL (§2A.6): delete the 10 fabricated reviews, the "4.7" average, the star breakdown and the "4,059 customer reviews" meta description.** Replace with an honest empty state. Real reviews land only after real orders, gated on `order_item_id`. **Visible content removal — strongly recommended (Consumer Protection Act exposure), but do not apply until a manager approves.**
9. 🔒 **PENDING APPROVAL, item by item (§2A.6):** audit every legacy claim against what will actually exist at launch — "250,000+ people", review counts, ratings, delivery promises. **Produce the list with exact before/after text and add it to §2A.6 first. Nothing is removed or corrected until each item is approved.**
10. Every form either posts to a real endpoint or is removed. **Zero `onsubmit="return false;"` equivalents may survive.** Binding a form to a real endpoint is implementation-only; **removing a form is a visible-content change and needs approval (§2A.6).**
11. Per-route `generateMetadata`, canonical URLs, Open Graph. `app/robots.ts` and `app/sitemap.ts` generated from real routes.
12. Responsive pass at 360 / 768 / 1024 / 1440 px. Accessibility pass: landmarks, heading order, focus visibility, form labels, colour contrast. **An accessibility fix that would change visible content or section order is a §2A.6 item, not a silent edit.**
13. **Produce the §2A.7 comparison evidence for every migrated page** — text-content diff, structural/heading diff, legal-page snapshots, responsive screenshots — and retain it alongside the legacy originals.
14. **Configure Google OAuth — deferred here from Phase 3 (10 Sep 2026).** Create the Google Cloud OAuth 2.0 client (consent screen + credentials); enter the client ID/secret in Supabase → Authentication → Providers → Google; register the dev and staging redirect URLs (`<site-url>/api/auth/callback`). Then verify sign-in end-to-end through the existing `/api/auth/callback` route and the existing Google button — both were built and left in place in Phase 3, so this is configuration plus verification, not new code. **Until this is done the Google button must not ship**, per task 10: an affordance that cannot reach a real endpoint is a dead form. The production redirect URL is added later, at Phase 20 task 12, because it does not exist until the production origin does. Recorded reason and evidence: §5 Phase 3, open item 4.

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
- **Regression test asserting the strings "4,059", "4.7 average" and the fabricated reviewer names appear nowhere in the built output** — *applies only once R20 is approved (§2A.6); until then these strings are expected to be present.*
- Accessibility: automated axe pass on every route, zero serious/critical violations.
- Responsive screenshots at the four breakpoints.
- **§2A.7 fidelity regression per page:** normalised visible-text diff and ordered landmark/heading diff, legacy versus migrated. Empty, or every difference traced to an approved §2A.6 row.

#### Validation
Crawl the built site; compare the route list against the 27-page inventory.
Grep the production build for fabricated content and for `cdn.shopify.com`
(expected to still be present — Phase 14 removes it).
**Run the §2A.7 comparison for all 26 pages and attach the output as phase
evidence — a migration that cannot show its fidelity has not shown it.**

#### Acceptance Criteria
- 26 pages reachable, no duplicated CSS/JS. `gift-cards.html` is not
  migrated and is not reachable by any route, nav link or sitemap entry.
- Zero dead forms.
- **§2A fidelity: every migrated page's visible text, section order and
  heading structure matches its legacy original, with every difference
  traced to an approved §2A.6 row. No unapproved content, wording,
  navigation, product-presentation or IA change anywhere.**
- **The legacy source files are byte-identical to their pre-Phase-4 state**
  (`index (7).html` MD5 `82aa9006…`; `vokr-production.zip` blob
  `02c5329`).
- Zero fabricated reviews, ratings or review counts — **conditional on R20
  approval (§2A.6). If approval is withheld, this criterion is waived and
  R20 remains open with the reason recorded.**
- `terms` says "email", not "email/SMS" — **conditional on R14 approval
  (§2A.6), same treatment.**
- `robots.txt` and `sitemap.xml` generated from real routes.

#### Production Checklist Mapping
**R14** (terms amendment), **R20** (remove fabricated reviews).

#### Dependencies
Phases 2 and 3.

#### Exit Criteria
The legacy site is **faithfully** represented by one application — same
sections, same order, same words, same navigation, same product
presentation — with no inert form, no unapproved change, and the §2A.7
comparison evidence on file for all 26 pages. The legacy source files are
untouched.

---

### PHASE 5 — Server-Side Cart

#### Status
**COMPLETE, 12 Sep 2026.** Full evidence in §0.2's Phase 5 row. Summary:
`carts`/`cart_items` migrated with the §3.5 constraints (two partial
unique indexes, a quantity CHECK, RLS); price and per-variant GST
resolved server-side on every read, never stored on the row; a `.strict()`
zod boundary makes the legacy client-controlled-pricing defect (R6)
generically impossible, verified against a live server with a real
price-injection attempt (400, nothing stored); guest→user cart merge
registered on the Phase 3 upgrade hook and proven idempotent under
genuine transaction concurrency, not just a sequential retry; cart UI
(drawer, quantity controls, line removal, live totals, out-of-stock
state) live in the header and PDP, closing the cart/Bag and Add-to-Cart
half of Phase 4's D5 exception. Two real defects found by this phase's
own tests and fixed: an `app_users`-row-creation ordering bug in
`completeSignIn()` that broke the merge handler's FK on a brand-new
user's first sign-in, and a `carts_has_an_identity` CHECK that didn't
account for a closed cart outliving its guest session.

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

#### Validation run — 12 Sep 2026
Done as specified, plus the concurrency case the wording implies but
doesn't spell out. **Guest→user merge:** `src/server/cart/__tests__/merge.integration.test.ts`
adds items as a guest, signs in, confirms the cart merged exactly once —
for a fresh user cart, for a user cart with an overlapping variant (summed
and capped at 10), and for a genuinely concurrent double-fired sign-in
(two racing transactions, not a sequential retry) via a raw
`SELECT … FOR UPDATE` guard on the guest cart row. **POST a price:** done
against a live `next dev` server, not only in tests — `curl -X POST
/api/cart/items -d '{"variantId":…,"quantity":1,"price":1,"total":1}'`
returned `HTTP 400 VALIDATION_ERROR` and stored nothing; a legitimate
follow-up request confirmed the stored line's price and the cart's GST
came only from `product_variants.price_paise` / `products.gst_rate_bps`
(`lineTaxPaise: 152466` for one ₹9,995 unit at 18% GST, matching the
unit-test math exactly).

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
`vokr/src/app/admin/**` · `vokr/src/server/admin/*` · `vokr/src/server/audit/*` · `vokr/src/proxy.ts`

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
`vokr/sentry.*.config.ts` · `vokr/src/lib/logger.ts` · `vokr/src/proxy.ts` · `vokr/src/app/api/health/**` · `vokr/src/instrumentation.ts`

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
Phases 3, 5, 7, 9, 12. Cloudflare managing DNS for `vokr.shop` — **not yet true; DNS is at Hostinger today (§3.7, ADR-030), so the migration to Cloudflare is a task of this phase, not a precondition.**

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
`vokr/src/proxy.ts` · `vokr/src/server/security/*` · `vokr/src/server/rate-limit/*` · `vokr/docs/security/waf-rules.md` · `.github/workflows/`

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
Cloudflare managing DNS — **currently Hostinger (§3.7, ADR-030); treat the move as an explicit cutover step with mail-flow and Brevo re-verification afterwards.**

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
Phase 19. Domain `vokr.shop` registered (**at Hostinger, which also holds DNS today — §3.7**). Cloudflare account.

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
12. **Google OAuth production redirect URL.** Add the production origin's `<production-origin>/api/auth/callback` to the authorised redirect URLs of the Google OAuth client created at Phase 4 task 14, alongside setting Supabase's `auth.site_url` to the production origin (it is `http://localhost:3000` today). Both are required before Google sign-in works in production; neither can be done earlier, because the production origin does not exist until this phase.

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
| **R12** | Brevo as Supabase Auth custom SMTP | Configured **before any real signup**; rate limit raised | 3 | **A confirmation email delivered to an address outside the project team** | Screenshot of the received email with headers | **BLOCKED — needs a human with Brevo + Supabase dashboard access; no Brevo account exists in this environment.** See Phase 3 Status, "Human checklist to close this phase" |
| **R13** | Raise Auth email rate limit; forward client IP | Limit raised; real client IP forwarded, or Auth called from the browser | 3 | Dashboard setting; a test showing per-IP not per-instance limiting | Screenshot; test output; ADR entry | **VERIFIED (10 Sep 2026)** — client IP is forwarded on every `/api/auth/*` call (ADR-025); this app's own `rate_limit_counters` limiting is built, integration-tested and is the defence actually relied on. **Per-IP-not-per-instance is now tested**: `src/server/rate-limit/__tests__/client-ip-bucketing.integration.test.ts` (6 cases) proves two forwarded client IPs occupy independent buckets, that `cf-connecting-ip` wins over a spoofed `x-forwarded-for`, that a genuinely separate `PrismaClient` (a second Cloud Run instance) observes the same shared counter rather than receiving its own allowance, and — by source assertion, since route modules sit outside the Vitest `node` project — that all three limited routes key on `getClientIp(request)` rather than a constant. **The “raise the limit” half is resolved as a decision, not a change: §0.3 D4 keeps `auth.rate_limit.email_sent` at 30/hour**, because 30/hour already exceeds the ≈12.5/hour sustainable under Brevo’s 300/day free allowance and neither this plan nor the PDF ever named a higher target. |
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
| **ADR-025** | *(new, Phase 3)* **This app's own `rate_limit_counters`-backed limiting, not Supabase's per-IP limit, is the authoritative defence against auth abuse** — Cloud Run's shared egress IP is still forwarded to Supabase as `X-Forwarded-For` on every `/api/auth/*` call as a best-effort second layer | R13: server-side calls to Supabase Auth all originate from Cloud Run's one egress IP, so Supabase's hosted per-IP rate limiter would otherwise cap *every* customer's sign-in attempts combined at ~6/minute. Whether hosted GoTrue trusts a forwarded header from an arbitrary caller is undocumented and outside this project's control, so the header is sent but not relied on — the IP-and-email-keyed Postgres counter this app owns and can verify is what's actually load-bearing. | Supabase documents and supports trusting `X-Forwarded-For` on hosted projects, and it is confirmed working end-to-end |
| **ADR-026** | *(new, Phase 3)* **`env.ts` split into `env.ts` (server) and `env-client.ts` (client-only)** | A Phase 3 client component importing the combined `env.ts` for `clientEnv` pulled the server schema's variable *names* into the client bundle — a real regression this phase's own bundle grep caught. Browser code now imports `clientEnv` from `env-client.ts` only, which contains nothing server-only. | Never — this is a correctness fix, not a preference |
| **ADR-027** | *(new, Phase 3)* **`src/middleware.ts` renamed to `src/proxy.ts`** | Next.js 16.0.0 deprecated the `middleware` file convention in favour of `proxy` (same location, same `config`/matcher shape, function renamed `proxy`) — confirmed against `node_modules/next/dist/docs/.../file-conventions/proxy.md`, not assumed from training data, per this repo's own "this is NOT the Next.js you know" warning. | Never, while Next 16's naming stands |
| **ADR-028** | *(new, 8 Sep 2026, manager-issued)* **Legacy fidelity over engineering preference** — the approved legacy layout structure, sections, wording, navigation, product presentation, legal copy and information architecture are reproduced faithfully in Next.js; only the implementation beneath them changes. Deviations require explicit manager approval, registered in §2A.6. | The legacy site is an *approved* design, not a draft. An engineer's judgement that a section is awkward, redundant or improvable is not a mandate to change it, and "it was cleaner to implement it this way" is the failure mode this ADR exists to prevent. Fidelity is also what makes the migration reviewable: a diff against the original is only meaningful if the original is supposed to survive. | The manager approves a redesign. Never by inference, never by an engineer acting alone. |
| **ADR-029** | *(new, 8 Sep 2026)* **The legacy source artefacts are immutable reference material** — `index (7).html`, `vokr-production.zip`, `vokr-production (1).zip` and `vokr-backend-scope.docx` are never edited, cleaned up, reformatted or regenerated | They are the only baseline the §2A.7 regression checks can compare against. Editing the reference destroys the ability to prove the migration was faithful. The 19.9 MB base64 homepage in particular keeps its payloads permanently — it is the evidence for R21, not a file to fix. | Never. R21 is closed in the new application, not in the legacy artefact. |
| **ADR-030** | *(new, 8 Sep 2026)* **`vokr.shop` DNS is managed at Hostinger until an explicit, executed migration says otherwise** | Recorded operational fact (§3.7). §3.1 and Phase 20 name Cloudflare as the *target*; that move has not happened, and planning against an assumed state is how DNS cutovers break email. Brevo's authentication records, Zoho's inbound records and the single merged SPF record all live in the Hostinger zone today. | Phase 20 actually executes the Cloudflare migration and verifies mail flow and Brevo authentication afterwards — at which point this row is updated, not deleted. |

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
13. **Legacy fidelity (§2A)** — for any phase touching migrated pages: no approved layout structure, section, wording, navigation item, product presentation, legal string or IA element changed without an approved §2A.6 row; the §2A.7 comparison evidence exists; and the legacy source artefacts are byte-identical to their pre-phase state.

**A phase whose exit criteria depend on a manual verification is not
complete until that verification has been performed.** R12 is not done
because SMTP is configured — it is done when an email arrives in an inbox
outside the project team. R17 is not done because backups run — it is done
when a restore has succeeded.

### Branching — one dedicated branch per feature or phase

**No feature work is implemented, committed or pushed directly on
`master`.** Every feature, phase or fix gets its own branch, cut from
`master` and named for the work it carries — `phase-3-auth-closure`,
`phase-5-server-cart`, `fix-webhook-replay`. This applies to any change
that touches code, schema or the migrations directory, and to the
documentation commits that accompany them.

This is the same discipline §5 already applies to phases — work the phases
in order, one at a time — expressed at the level of the repository:

- **Branch first.** Cut the branch before the first edit, not after. If
  work has already begun on `master`, move it to a branch before
  committing.
- **One branch, one scope.** A branch carries one phase or one feature.
  Unrelated changes that happen to be in the working tree stay unstaged;
  DoD item 10's "clean, scoped commit" is a property of the branch as well
  as the commit.
- **The branch must stand on its own.** It has to build and pass
  `npm run verify` from a clean checkout — not merely in the working tree
  it was written in. A commit whose imports resolve only against untracked
  local files is not scoped, it is broken; if a test needs a module, that
  module belongs in the same commit.
- **`master` stays releasable.** It is only ever advanced by merging a
  branch whose phase satisfies §12.
- **Never rewrite published history.** Amend, squash or rebase only
  commits that have not left the machine.

Phase 3 is the worked example: closed on `phase-3-auth-closure` in a
single 8-file commit, verified beforehand against a `git archive` of the
index with a real `npm ci`, which is what caught both an unresolvable
import and a 50%-flaky test before either reached `master`.

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
- [ ] DNS, SSL, cache rules correct; no identity-bearing response cached — **at whichever provider holds the zone at launch. Today that is Hostinger (§3.7), not Cloudflare; if the Cloudflare migration ran, re-verify mail flow and Brevo authentication after cutover**
- [ ] **Brevo domain authentication reported VERIFIED by Brevo itself** (§3.7.1) — records present in DNS is not verification
- [ ] All five `@vokr.shop` mailboxes receiving; SPF is a single merged record covering Zoho and Brevo
- [ ] Rollback performed and timed

### 13.18 Content & legal
- [ ] **§2A fidelity: every migrated page matches its approved legacy original in visible text, section order, heading structure, navigation and product presentation — every difference traced to an approved §2A.6 row**
- [ ] **§2A.6 contains no row still marked PENDING that was nonetheless implemented**
- [ ] **Legacy source artefacts unmodified** — `index (7).html` MD5 `82aa900609d7bae122064c87925308b4`; `vokr-production.zip` blob `02c5329`
- [ ] **R14: terms say "email", not "email/SMS"** ✱ *(requires §2A.6 approval; if withheld, R14 stays open with the reason recorded)*
- [ ] **R20: zero fabricated reviews, ratings or review counts, CI-enforced** ✱ *(requires §2A.6 approval; same treatment)*
- [ ] Every published claim verified or removed *(each change approved in §2A.6 first)*
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
