# Fulfilment and the admin panel

Plan §5 Phase 12 (admin) and Phase 10 tasks 2–3 (Shiprocket export, AWB
entry). The Shiprocket **API** is deliberately deferred (Phase 10 Out of
Scope, ~600+ orders/month): orders reach Shiprocket by CSV upload in its
panel, and the AWB comes back by hand.

Code: `src/server/admin/*`, `src/app/admin/**`, `src/app/api/admin/**`,
`src/components/admin/*`. Migration `20261016175750_admin_ops`. Tests:
`src/server/admin/__tests__/*`, `src/server/net/__tests__/proxy-admin.test.ts`.

## Access

- `/admin` and `/api/admin/**` answer **404** to anyone who is not an
  active admin — signed out, signed in without the flag, or erased. The
  proxy decides this before anything renders (a page's own `notFound()`
  would come too late: the root `loading.tsx` has already streamed HTTP
  200). Route handlers and pages check again.
- An admin session lasts **8 hours from sign-in** (the access token's
  `amr` timestamp; token refreshes do not extend it). After that the panel
  is a 404 again until you sign in again at `/sign-in`.
- A **refund** needs a sign-in within the last **15 minutes** (the API
  answers 401 "Sign in again to confirm this action").
- 120 admin API calls per minute per admin.
- Defence in depth still owed: the Phase 12 requirement is a Cloudflare
  **block** of `/admin*` and `/api/admin*` outside a restricted set of IPs.
  That needs the owner's `ADMIN_IPS` (rule 2's block variant).
- Until then, Cloudflare WAF rule `vokr-2` (live 19 Oct 2026) puts a
  managed challenge in front of `/admin*` and `/api/admin*`; anyone can
  pass it, so it slows scanners but restricts nobody. Expect to solve it
  about every 30 minutes (Cloudflare's default clearance; this zone's
  Challenge Passage setting was not readable). If a form says "Request failed (403)."
  after the page sat open, the challenge stopped it before the server —
  nothing was changed; reload the page, pass the check, and retry. See
  `infra/cloudflare/waf-rules.md` → "Rule 2 and the admin pages".

### Granting the first admin (owner, production SQL)

No route can grant admin. The person must have signed up and signed in once
(so their `app_users` row exists). Then, on the production database:

```sql
-- Check first: exactly one row, the right email.
SELECT id, email, is_admin, deleted_at FROM app_users WHERE email = '<owner email>';
UPDATE app_users SET is_admin = true WHERE email = '<owner email>' AND deleted_at IS NULL;
```

Revoke with `SET is_admin = false`. Record every grant/revoke in the plan.

## Daily fulfilment

1. **Orders → status `confirmed`.** Open each new order, check it, move it
   to **preparing** (packing). Cancel instead if it cannot be fulfilled
   (then refund — below).
2. **Export.** Orders page → "Shiprocket CSV (preparing)". The download
   is audit-logged with the order numbers (it contains customer contact
   details — treat the file as PII: upload, then delete it).
3. **Upload** in Shiprocket: Orders → Add Order → Bulk upload. Shiprocket
   reports failed rows in an error file; fix and re-upload those only.
4. **Ship.** When Shiprocket assigns the AWB, open the order → **shipped**,
   entering courier and AWB. This writes history and an audit row and queues
   the "your order has shipped" email (sent by the maintenance job within
   ~5 min, if Brevo is configured).
5. **Delivered / RTO / returned** as the courier reports them.

### Before the first real upload (once)

- Download Shiprocket's own sample file (Bulk upload → "Download sample")
  and compare its header row with `SHIPROCKET_HEADERS` in
  `src/server/admin/shiprocket-csv.ts`. The header list was taken from
  Shiprocket's knowledge base on 16 Oct 2026, and Shiprocket rejects a file
  whose header row differs. If they differ, the code changes, not the file.
- Every SKU must exist in Shiprocket's catalogue (Setup & Manage →
  Catalogue) with the **same** SKU string as Vokr's (e.g. `VK-MX-WHTBLK-IN09`).
- Configure a default package (dimensions) in the panel: the export
  carries only weight, the sum of the variants' catalogue `weight_grams`
  (product weight — packaging is not modelled).
- Export conventions to know: one row per order line; shipping and COD
  charges and weight on the order's first row only; channel `CUSTOM`; a
  single-word name repeats as the last name (Shiprocket requires one); an
  empty address line 2 carries the city (the column is mandatory); cells a
  spreadsheet could read as a formula are prefixed with `'`.

## Refunds

Order page → "Queue full refund": retype the order number and give a
reason. This **does not call Razorpay**. It opens a `payment_issues` row
(`reason = admin_refund`) in the same transaction as the audit row, and the
maintenance job refunds it exactly like a late payment
(`late-payments.md`): one refund of exactly the captured amount, under a
stable idempotency key; a crash after Razorpay accepts it is adopted, not
repeated; the order and payment move to `refunded` only when Razorpay lists
processed refunds covering it. Anything odd lands in `manual_review` on the
Exceptions page.

- **Needs Razorpay keys.** Without `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`
  the maintenance job's refund step reports `not_configured`, and a queued
  refund stays `open` on the Exceptions page until keys exist. With keys,
  it is processed on the next run (every 5 minutes).
- Full refunds only. Partial refunds: Razorpay dashboard, then the issue
  shows in `manual_review`; reconcile by hand.
- COD orders have no online payment to refund (COD is not built — D11).
- Refunds **never restock**. If the goods come back sellable, adjust stock.
- An operator can never set an order to `refunded` directly.

## Stock

Inventory page: enter a +/− change and a reason. The change is applied
only if on-hand is still what the page showed (so a double click or a sale
in between is refused — reload and retry), never below zero and never below
the units held by checkouts in progress. Every change is audit-logged. This
is also how **launch stock** is entered and how units come back after a
cancellation, RTO or return. The storefront's stock display may lag up to
the catalog cache TTL on other instances; checkout always re-checks under
lock.

## Exceptions page

What to look at every day, and what each means:

| Section | Meaning | Action |
|---|---|---|
| Orphan counts | Paid session without order / captured payment with neither order nor issue / prepaid order without capture | Should be 0. Investigate immediately (logs tag `ORDER_ORPHAN`). |
| Payment issues `open` / `refund_initiated` | A refund the job is working on | None; it resolves within a few runs. |
| Payment issues `manual_review` | The job will not decide alone (partial, failed, mismatch…) | Read `last_error`, act in the Razorpay dashboard; the issue closes itself once a processed refund covers it. |
| Failed emails | Brevo refused or the send was interrupted past the dedup window | Contact the customer if it matters. |
| Webhook errors | A verified webhook that could not be applied (`UNMATCHED_PAYMENT`, amount mismatch…) | See `late-payments.md`. |
| Stuck orders | `confirmed`/`preparing` untouched for 48 h | Ship or cancel. |

## Audit

`audit_log` gets one row per operator action (`inventory.adjust`,
`order.transition`, `order.refund`, `pii.reveal`, `export.shiprocket`) with
actor, before/after and reason, written in the same transaction as the
change. A trigger refuses `UPDATE`. Customer details are revealed only on
request with a reason, and that reveal is itself audited.

## Not built (by design or blocked)

Shiprocket API; COD lifecycle and remittance (D11); returns/exchange
request flow for customers (Phase 10 task 7); RTO re-ship charge;
`/admin` WAF rule (D9); invoices (D2/D3).

## Admin browser test (local only)

`e2e/admin/admin.spec.ts` drives `/admin` in Chromium with a real Supabase
session from a **local** stack. Never point it at production. Last run on
19 Oct 2026: **4/4 passed**.

1. `npx supabase start` (Docker), then `npx supabase status -o env` for `API_URL` and `ANON_KEY`.
2. Delete earlier test users, or sign-up answers with its neutral
   "confirmation link is on its way" message and the spec fails:
   `docker exec supabase_db_vokr psql -U postgres -c "DELETE FROM auth.users WHERE email LIKE '%@e2e.test'"`.
3. Create a fresh `vokr_admin_e2e` on Compose Postgres, then run `prisma migrate deploy`,
   `prisma db seed` and `tsx e2e/admin/seed.ts 3`, with `DATABASE_URL` pointing at it.
4. `npm run build` with `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` from step 1 and
   `NEXT_PUBLIC_SITE_URL=http://localhost:3003`. Then start
   `.next/standalone/server.js` on port 3003, after copying `.next/static` and `public`.
5. `ADMIN_E2E_BASE_URL=http://localhost:3003 ADMIN_E2E_DATABASE_URL=<step 3> npx playwright test -c playwright.admin.config.ts`
6. `npx supabase stop`.
