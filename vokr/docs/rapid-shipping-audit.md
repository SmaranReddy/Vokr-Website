# Rapid shipping audit

**Audit time:** 16 Oct 2026, ~18:00–19:30 UTC. **Base:** `master` `5a5a799`
(PR #34). **Production:** Cloud Run `vokr-00036-b2d`, 9 migrations
(verified live: `/` 200, `/api/health` 200, `/checkout` 404, scheduler OK).
The plan's §0.0 Checkpoint is the running status; this file records the
audit, the shortcuts taken and the launch decision.

Evidence labels: **prod** (verified on vokr.shop), **int** (integration
test on real Postgres, providers faked), **unit**, **build/HTTP** (local
production build probed over HTTP), **none** (not verified).

## 1. State found

| Area | State | Evidence |
|---|---|---|
| Catalog, cart, checkout, pricing, PIN serviceability (Ph 2–6) | Built and deployed; ordering gated off | prod + int |
| Razorpay orders, verified webhooks, reconciliation, late-payment refunds, bag-paid-twice guard (Ph 7–8) | Built and deployed; **never run against Razorpay** (no test keys) | int (faked Razorpay) |
| Reservations, expiry, concurrency, oversell (Ph 8) | Built and deployed | int (real concurrent transactions) |
| Orders, guest lookup, history (Ph 9) | Built and deployed | int + prod (gated 403) |
| Email outbox, order confirmation (Ph 11) | Built and deployed; `not_configured` (no Brevo key) | int (faked Brevo) |
| Security headers, CSRF, route inventory, CSP report-only, deps (Ph 16) | Deployed | prod |
| **Admin panel (Ph 12)** | **Was not started → built in this pass** | int + unit + build/HTTP |
| **Manual fulfilment: AWB entry, Shiprocket CSV, shipped email (Ph 10 tasks 2–3)** | **Was not started → built in this pass** | int + unit |
| COD lifecycle, returns/exchange flow, RTO charges (Ph 10 rest) | Not built — COD blocked on D11 | none |
| Invoices (gap-free numbering, GST invoice) | Not built — blocked on D2/D3 | none |
| Backups | Manual `pg_dump` + restore tests before each migration (`C:\Users\Asus\vokr-backups\`) | restore logs |
| Browser E2E of checkout/payment | Not run — `/checkout` is gated, no Razorpay test keys | none |

Baseline on `master` before changes: `npm run verify` green;
`npm run test:integration` 229/229.

## 2. Shortcuts chosen

| Gap | Options compared | Chosen | Why |
|---|---|---|---|
| Admin UI | Kiranism next-shadcn-dashboard-starter (MIT); shadcn/ui blocks (MIT); vercel/commerce (MIT, storefront only); plain server-rendered pages | **Plain server components + 6 small client forms, no new dependency** | The starter is built around Clerk, which AGENTS.md rejects; shadcn blocks need Radix plus a component setup this repo doesn't have. The plan asks for "functional, not attractive", and the backend correctness was the real work. |
| Admin refunds | New refund endpoint calling Razorpay; reuse the `payment_issues` queue | **Reuse the queue** | It already has an idempotency key, adopt-after-crash, close-only-on-processed-refunds and manual review, all tested. No second money path. |
| Shiprocket | API SDK / integration; panel CSV upload | **CSV export** (plan Phase 10 defers the API to ~600 orders/month) | Header list from Shiprocket's knowledge base ("Bulk CSV Import Orders"); **must be diffed against the panel sample before first use** (moderate confidence it is current). |
| Admin auth | Separate `admin_sessions` store; existing Supabase session + flag | **Supabase session + `app_users.is_admin`**, 8 h absolute from sign-in (`amr`), 15 min re-auth for refunds | No second session store; the limit cannot be extended by token refresh. |
| Admin 404 | Page-level `notFound()`; proxy gate | **Proxy gate** (plus route and page checks) | Root `loading.tsx` makes a page-level `notFound()` a 200. |

No dependency was added.

## 3. Built in this pass (branch `feat/phase-12-admin`)

Migration `20261016175750_admin_ops` (additive): `app_users.is_admin`;
`audit_log` (append-only trigger, RLS); `orders.courier/awb/shipped_at`
(all-or-none CHECK); `email_template += order_shipped`.

- Admin gate: real 404 for everyone but an active admin, checked in the proxy, the route and the page; per-admin rate limit; every response `no-store`.
- Stock adjustment: requires a reason and the on-hand value the operator saw; never below held units; audited. This is how launch stock is entered.
- Orders: list (filter by status, method, order number or PIN) and detail.
- Transitions go through the shared state machine. `refunded` can never be set by hand.
- Ship records courier and AWB and queues the shipped email (DRAFT copy).
- Full refund: retyped order number, recent sign-in, queued on the existing refund path; capped at the captured amount by construction.
- PII reveal is audited; the Shiprocket CSV export is audited and formula-injection-safe.
- Exceptions view: orphans, payment issues, failed emails, webhook errors, stuck orders.
- Runbook: `docs/infrastructure/fulfilment.md`.

## 4. Verification matrix

| Journey / case | Status | Evidence |
|---|---|---|
| Two customers compete for the last unit; no oversell | PASS | int (`reservation.integration.test.ts`) |
| Reservation expiry and release | PASS | int |
| Duplicate checkout submit / idempotency | PASS | int |
| Duplicate, invalid or out-of-order webhook | PASS | int (faked provider) |
| Late capture after expiry → automatic full refund (D12 default) | PASS | int (faked provider) |
| Payment captured but order creation fails → recovered by reconciliation | PASS | int |
| Real Razorpay test-mode payment, webhook, refund | **BLOCKED** | needs test keys + webhook secret |
| Order confirmation sent once, retried, provider failure | PASS | int (faked Brevo) |
| Real email to an external inbox | **BLOCKED** | needs Brevo key + verified sender |
| Admin: non-admin/unauthenticated → 404 on every admin route (incl. encoded paths) | PASS | unit (proxy) + build/HTTP |
| Admin: stock adjust, stale value refused, double submit applies once | PASS | int |
| Admin: illegal transition refused; `refunded` not settable | PASS | int + unit |
| Admin: ship → AWB stored → shipped email sent once | PASS | int (faked Brevo) |
| Admin: refund queued once → job refunds exactly the captured amount once → payment and order `refunded`; no restock | PASS | int (faked Razorpay) |
| Admin: every mutation and PII reveal audited; audit rows immutable | PASS | int |
| Admin pages render with real rows | PASS | int (server render; guard stubbed) |
| Admin pages in a browser with a real admin session | **NOT RUN** | needs the first admin grant (owner) |
| Shiprocket CSV accepted by the panel; real shipment | **BLOCKED** | Shiprocket account + panel sample |
| COD, returns/exchanges, RTO | **NOT BUILT** | D11, Phase 10 |
| Compliant invoice | **NOT BUILT** | D2, D3 |
| Backup restore | PASS (per migration) | restore-tested backups in `vokr-backups` |

## 5. Owner actions (smallest list that unblocks launch)

1. **Razorpay test keys + webhook secret** into Secret Manager → agent runs the sandbox payment/refund matrix.
2. **Brevo:** verify `support@vokr.shop` as sender (or authenticate the domain), then add `BREVO_API_KEY`; sign off the DRAFT confirmation and shipped email copy.
3. **D2** GST rate + HSN per SKU (from your CA). **D3** legal entity, GSTIN, registered address (Razorpay live KYC + invoices). **D11** flat shipping fee and COD fee (or decide prepaid-only launch). **D12** confirm the automatic full refund policy for late payments.
4. **First admin:** sign up/in once on vokr.shop, then run the SQL in `docs/infrastructure/fulfilment.md` (production SQL — owner only). Then open `/admin` and confirm it renders.
5. **Shiprocket:** account with the SKUs in its catalogue; download the bulk-upload sample and compare headers with `SHIPROCKET_HEADERS`.
6. **D9** Cloudflare cutover (WAF rule for `/admin*`).
7. Enter launch stock via `/admin/inventory`.

## 6. Launch decision

**NO-GO for production purchasing.** `ORDERING_ENABLED` and
`RAZORPAY_LIVE_MODE_ALLOWED` stay `false`. The release candidate is
engineering-complete for prepaid ordering and manual fulfilment, but no
payment, refund or email has completed against the real providers, there is
no compliant invoice (D2/D3), and fees are undecided (D11). The fastest path
to GO is owner items 1–4, then a sandbox payment → order → ship → refund run
in test mode, then a real ₹ test purchase with the owner's approval.
