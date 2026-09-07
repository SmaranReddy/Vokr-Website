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

This codebase is currently at **Stage 1: foundation**. It establishes the
application structure, styling, environment-variable conventions, and
tooling that later stages (database, auth, payments, checkout, admin) build
on. No business logic, database, or third-party integrations exist yet.

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available scripts

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Start the development server                  |
| `npm run lint`      | Run ESLint                                    |
| `npm run typecheck` | Generate route types, then run `tsc --noEmit` |
| `npm run build`     | Production build                              |
| `npm run start`     | Serve the production build                    |

Run `npm run lint && npm run typecheck && npm run build` before opening a
pull request.

`typecheck` runs `next typegen` first because the App Router's
route-aware globals (`LayoutProps`, `PageProps`, `RouteContext`) are
generated into the git-ignored `.next/types`. Without it, `tsc` fails on
a clean checkout.

## Project structure

```
src/
  app/          Routes only — pages, layouts, loading/error/not-found states
  components/
    ui/          Small, generic UI primitives (Button, Container, ...)
    layout/      App-wide chrome (header, footer)
  config/        Static app configuration (site metadata, etc.)
  lib/           Framework-agnostic helpers (class-name merging, metadata builder)
  styles/        Global stylesheet (Tailwind entry point)
```

`app/` is kept purely for routing, per Next.js's own recommendation —
anything that isn't a route file lives in one of the top-level `src/`
folders above.

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
- Nothing in this codebase currently reads these variables beyond
  `NEXT_PUBLIC_SITE_URL` — they exist as a reserved contract, not live
  integrations.

## What's not here yet

By design. See the PDF for the full breakdown and build order. Not yet
implemented: database/Prisma, Supabase Auth, Razorpay checkout, cart,
inventory, order management, search, admin panel, and any Cloud Run/GCP
deployment configuration. These land in later stages on top of this
foundation.
