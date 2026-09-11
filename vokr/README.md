# Vokr

Vokr is a footwear D2C brand. This repository is the production rebuild of
its storefront — a single Next.js application replacing the previous
27-page static HTML site.

The full production architecture (hosting, database, payments, auth,
storage, etc.) is defined in the **Vokr Zero-Cost Production Tech Stack &
Production Readiness Checklist** PDF at the root of the workspace. That
document is the source of truth for every infrastructure decision — this
README only covers what exists in this codebase today.

Day-to-day engineering reference: **`../Vokr-Implementation-Plan.md`**
(the phased plan and its status) and **`AGENTS.md`** (the non-negotiable
architecture and security rules).

This codebase has completed **Phase 2: catalog + database** and
**Phase 3: authentication + guest sessions**, which is verified and ready
to close (see "Authentication" below). Phase
1 established the application structure, styling, environment-variable
conventions and tooling; Phase 2 adds Postgres (via Prisma), the launch
catalog schema, a deterministic seed of the five launch SKUs, and two
read-only catalog API routes; Phase 3 adds Supabase Auth (email/password +
Google), guest sessions, the guest-to-user identity transition, and
Postgres-backed rate limiting on every auth endpoint. Cart, checkout,
payments and admin still build on top of this. See
`../Vokr-Implementation-Plan.md` for the phase-by-phase status.

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `npm run dev`               | Start the development server                  |
| `npm run lint`              | Run ESLint                                    |
| `npm run typecheck`         | Generate route types, then run `tsc --noEmit` |
| `npm run test`              | Unit tests (no external services required)    |
| `npm run test:integration`  | Integration tests against a live Postgres     |
| `npm run build`             | `prisma generate`, then production build      |
| `npm run start`             | Serve the production build                    |
| `npm run verify`            | lint + typecheck + `test` + build (CI gate)   |
| `npm run db:migrate`        | Create/apply a migration in development       |
| `npm run db:migrate:deploy` | Apply pending migrations (production/CI)      |
| `npm run db:seed`           | Seed the five launch SKUs (idempotent)        |
| `npm run db:studio`         | Prisma Studio                                 |

Run `npm run verify` before opening a pull request.

`typecheck` runs `next typegen` first because the App Router's
route-aware globals (`LayoutProps`, `PageProps`, `RouteContext`) are
generated into the git-ignored `.next/types`. Without it, `tsc` fails on
a clean checkout.

## Database — local development

```bash
docker compose up -d          # Postgres on localhost:55432 (not 5432 —
                               # some machines already run a native
                               # Postgres service on 5432; see
                               # docker-compose.yml)
cp .env.example .env.local    # then fill in DATABASE_URL / DIRECT_URL
npm run db:migrate            # first run: creates + applies migrations
npm run db:seed               # idempotent — safe to re-run
npm run test:integration      # exercises the schema against a real DB
```

`npm run test` and `npm run verify` never require Postgres — they stay
dependency-free by design (Phase 1). Only `test:integration` and the
`db:*` scripts touch a live database.

## Database — real Supabase project

The repository is linked to the real Supabase project (`ap-south-1` /
Mumbai) via `supabase link` — see `supabase/config.toml`. **`.env.local`
stays pointed at local Compose Postgres deliberately**: it's also loaded
by `test:integration` (`vitest.integration.setup.ts`), which runs
destructive checks (idempotent re-seed, CHECK-violation inserts, RLS
toggling) that must never touch production data.

To run `prisma migrate deploy` / `prisma db seed` against the real
project, supply `DATABASE_URL` / `DIRECT_URL` as ad-hoc environment
variables for that one command — never write real Supabase credentials
into `.env.local`. Get the pooled/direct connection strings from the
Supabase dashboard (Settings → Database → Connection string):

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

**Migrations and seeding must run against the session pooler (port
5432, the `DIRECT_URL` value), not the transaction-mode pooler (port
6543).** `prisma migrate deploy` against the 6543 URL fails with
`ERROR: prepared statement "s1" already exists` — PgBouncer's
transaction mode doesn't support the prepared-statement reuse Prisma's
schema engine relies on for DDL. The transaction-mode pooler (6543) is
correct for the running application's normal queries; it is not correct
for `migrate deploy` or `db seed`. In practice this means setting
`DATABASE_URL` to the *session pooler* URL (i.e. the same value as
`DIRECT_URL`) for those two commands specifically.

Every seeded variant starts `status: "draft"` and every seeded product
starts with `gst_rate_bps: NULL`. This is intentional, not a bug: decision
D2 (GST rate + HSN per SKU — see `../Vokr-Implementation-Plan.md` §0.3) is
still open, and a database trigger refuses to let any variant reach
`"active"` status while its product has no confirmed GST rate. Nothing is
purchasable until D2 is answered; the catalog is fully browsable in the
meantime (`GET /api/catalog/products`).

## Project structure

```
prisma/
  schema.prisma  Database schema (products, product_variants, inventory,
                 app_users, guest_sessions, rate_limit_counters)
  migrations/    Hand-reviewed SQL migrations (CHECK constraints, the GST
                 trigger and RLS live here — Prisma's schema language has
                 no primitive for them)
  seed-data.ts   The five launch SKUs + the upsert logic (shared by...)
  seed.ts        ...the CLI entrypoint `prisma db seed` runs
src/
  app/          Routes only — pages, layouts, loading/error/not-found states,
                 and `api/` route handlers
    (auth)/      Sign-in, sign-up, forgot-password, reset-password pages
    api/auth/    signup, signin, signout, reset, callback (OAuth) route handlers
  components/
    ui/          Small, generic UI primitives (Button, Container, ...)
    layout/      App-wide chrome (header, footer)
    auth/        Sign-in/up/reset forms, the Google button (all client components)
  config/        Static app configuration (site metadata, etc.)
  generated/     `prisma generate` output — git-ignored, regenerate with
                 `npm run db:generate`
  lib/           Framework-agnostic helpers (class-name merging, metadata
                 builder); `env.ts` / `env-client.ts` (see below);
                 `supabase-browser.ts` (the browser-only Supabase client)
  server/
    db/          The Prisma client singleton
    catalog/     Catalog read service, in-process TTL cache, DTOs
    auth/        Session/identity resolution, guest tokens, the Supabase
                 server client, the guest-upgrade handler registry
    rate-limit/  Postgres-backed fixed-window rate limiting
    net/         Request-level helpers (real client IP resolution)
  styles/        Global stylesheet (Tailwind entry point)
proxy.ts         Next.js 16's `middleware.ts` replacement — refreshes the
                 Supabase session cookie on every request
```

`app/` is kept purely for routing, per Next.js's own recommendation —
anything that isn't a route file lives in one of the top-level `src/`
folders above.

`env.ts` is split into two modules: `env-client.ts` holds only the
`NEXT_PUBLIC_*` schema and `clientEnv`, and `env.ts` builds the
server-only schema on top of it. Browser-only code must import
`clientEnv` from `env-client.ts` directly, not from `env.ts` — importing
the combined module from client code pulls the server schema's *variable
names* (not values, but still a needless disclosure) into the client
bundle, which is exactly what a `.next/static` grep for
`SUPABASE_SERVICE_ROLE_KEY` and friends is meant to catch.

## Authentication (Phase 3)

Email/password sign-in, guest sessions, the guest → user identity
transition, email confirmation and password reset are implemented,
unit/integration tested, and **verified against the real Supabase project
with real Brevo-delivered email**.

**R12 is closed.** Brevo is live as Supabase Auth's custom SMTP provider
(`smtp-relay.brevo.com:587`, read back from the project), and confirmation
emails have arrived in inboxes **outside** the project team on two
unrelated domains, been followed, and signed the customer in — with the
`app_users` row written in the same operation. That was the single most
dangerous item in the plan; it is evidenced, not assumed.

**Password reset works cross-browser.** Both link flows redeem their
one-time token **server-side** via `verifyOtp()` —
`/api/auth/confirm?token_hash=…&type=signup` and
`/api/auth/reset/confirm?token_hash=…&type=recovery`. This matters
because the earlier PKCE `exchangeCodeForSession()` approach needed a
verifier cookie held only by the browser that started the flow, so any
link opened on a phone, in webmail, or in a private window failed. The
endpoints are deliberately separate and each accepts only its own OTP
type: a recovery token can never be redeemed into a plain sign-in.

**Two deliberate positions, both recorded in the plan rather than left
implicit:**

- **`auth.rate_limit.email_sent` stays at 30/hour** (decision D4). Brevo's
  free tier allows 300 emails/day ≈ 12.5/hour sustained, so 30/hour is
  already more than double the sustainable rate; raising it would only let
  one bad hour consume the day's budget. Revisit on a paid Brevo plan.
- **Google OAuth is deferred to Phase 4.** The provider is not configured
  (`/auth/v1/settings` reports `google: false`), so the Google button must
  not ship until it is — Phase 4 task 14 covers the setup and the
  verification together.

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is set in `.env.local` (from the Supabase
dashboard, Settings → API); `NEXT_PUBLIC_SUPABASE_URL` is too — see
"Database — real Supabase project" above. Note that `auth.site_url` on the
project is still `http://localhost:3000` and must become the production
origin at deploy (Phase 20), which is also where the production OAuth
redirect URL is registered.

**Start the dev server from a shell with no `DATABASE_URL` exported.**
Next.js gives a shell-exported value precedence over `.env.local`, so a
variable left over from a one-off `prisma migrate deploy` silently
repoints the whole application at production. Use
`env -u DATABASE_URL -u DIRECT_URL npm run dev` if in doubt. See
`../Vokr-Implementation-Plan.md` Phase 3 for the full status.

## Environment variables

Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

- Variables prefixed `NEXT_PUBLIC_` are inlined into the client bundle at
  build time and must never hold a secret.
- Everything else in `.env.example` is server-only and documents the
  naming convention for services that later stages will wire up: Supabase
  (database + auth), Razorpay (payments), Brevo (transactional email),
  Sentry (error monitoring), and Cloudflare R2 (object storage).
- **No `.env*` file is committed except `.env.example`.** In production,
  secrets are never read from a file — they load once at process boot
  from Google Secret Manager (see the PDF, section 7).
- `DATABASE_URL` and `DIRECT_URL` are read as of Phase 2 (Prisma, the
  catalog service). `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read as of Phase 3 (Supabase Auth) —
  see "Authentication" above. Everything else in `.env.example` still
  documents a naming convention for services later phases wire up:
  Razorpay, Brevo, Sentry, Cloudflare R2.

## What's not here yet

By design. See `../Vokr-Implementation-Plan.md` for the full phase
breakdown. Not yet implemented: cart, checkout, Razorpay, inventory
_reservation_ (the schema and its constraints exist; the Phase 8 locking
transaction does not), order management, search, admin panel, and any
Cloud Run/GCP deployment configuration. These land in later phases on top
of this foundation.

Gift cards are not a "not yet" item — they are deferred from launch
entirely (decision D1, 8 Sep 2026). No gift-card page, purchasing,
redemption or ledger functionality will be built unless a future decision
reverses D1.
