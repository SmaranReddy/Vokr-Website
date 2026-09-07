# Vokr — engineering rules

Vokr is an Indian D2C footwear storefront being rebuilt as a single
Next.js application. Real money, real inventory, real customer PII.

## Read before doing anything

1. **`../Vokr-Implementation-Plan.md`** — the living plan. Which phase is
   active, what is in scope, what "done" means. Update its status blocks
   as work lands; never let it drift from the code.
2. **`../Vokr-Zero-Cost-Production-Tech-Stack-and-Readiness-Checklist.pdf`**
   (v1.0, 7 Sep 2026) — the authoritative architecture. It supersedes
   `../vokr-backend-scope.docx`, which is legacy and conflicts with it.

Work the phases in order. Do not start a later phase's feature work while
an earlier phase is open.

## Non-negotiable rules

These are not preferences. Each one maps to a defect the codebase review
already found, or to a free-tier limit the stack depends on.

**Money**

- The client never sends a price. Prices resolve server-side from a
  variant ID, always.
- GST is computed per variant, never a global constant. ₹295 laces and
  ₹9,995 shoes are not in the same slab.

**Payments**

- Order state is driven by the verified Razorpay webhook, never by the
  browser callback.
- Verify the webhook signature on every request. Handle redelivery.
- Idempotency keys on every order-creation and payment endpoint.

**Inventory**

- Reserve inside a database transaction with `SELECT … FOR UPDATE`, plus
  a `CHECK (quantity_available >= 0)` constraint as the backstop.
  Application logic alone is not sufficient.
- The Razorpay network call stays **outside** the row lock.

**Database**

- Never `SELECT *`. Every returned column is Supabase egress against a
  5 GB/month cliff that ends in HTTP 402 across all services.
- No images and no logs in Postgres. Images go to R2; logs go to Cloud
  Logging, then R2.
- Prune abandoned carts and rate-limit rows on a schedule — the 500 MB
  storage limit is cumulative and never resets.
- Stable identifiers only. A product display name is never a key.

**Security & privacy**

- The Supabase service-role key never reaches the browser.
- Guest order lookup is unauthenticated by design ("no login required"
  is a published promise) and must therefore be rate-limited and
  enumeration-resistant.
- Scrub PII before anything reaches Sentry.
- Never publish fabricated reviews, ratings or review counts.

**Operations**

- `max-instances` is always set. Billing budget alerts are always live.
- Secrets load once at process boot, never per request. Never exceed 6
  active Secret Manager versions — disable the old one when rotating.
- The keep-warm health check must touch Postgres, not just Cloud Run.

## Rejected until evidence says otherwise

Redis · a separate queue or worker · any search engine · Postgres FTS ·
SMS/phone OTP · Clerk · Neon · a separate Cloudflare Pages deploy · GCS
for backups · Cloud Run `min-instances`. Each was considered and rejected
for a stated reason (plan §11). Do not reintroduce one without adding an
ADR entry that says what changed.

## Definition of done

Compiling is not done. See the plan's §12 — implementation, tests,
validation, error handling, security review, observability, migration
safety, docs, and a clean commit.

## Commands

```bash
npm run dev        # development server
npm run lint       # eslint
npm run typecheck  # next typegen && tsc --noEmit
npm run build      # production build
```

Run `npm run lint && npm run typecheck && npm run build` before committing.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
