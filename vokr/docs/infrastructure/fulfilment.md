# Fulfilment and the admin panel

Plan §5 Phase 12 (admin) and Phase 10 tasks 2–3 (Shiprocket export, AWB
entry). The Shiprocket **API** is deliberately deferred (Phase 10 Out of
Scope, ~600+ orders/month): orders reach Shiprocket by CSV upload in its
panel, and the AWB comes back by hand.

Code: `src/server/admin/*`, `src/server/returns/*`, `src/app/admin/**`,
`src/app/api/admin/**`, `src/app/api/returns/**`, `src/components/admin/*`.
Migrations `20261016175750_admin_ops`, `20261017143950_returns_rto`. Tests:
`src/server/admin/__tests__/*`, `src/server/returns/__tests__/*`,
`src/server/net/__tests__/proxy-admin.test.ts`.

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
- Defence in depth still owed: a Cloudflare WAF rule restricting `/admin*`
  and `/api/admin*` (Phase 20; needs the D9 cutover).

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
5. **Delivered / RTO** as the courier reports them (status change). Returns
   and failed deliveries coming back: next section.

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

## Returns, exchanges and failed deliveries (RTO)

Published policy (terms §7–8, `/support-exchange-returns`): 30 days from
delivery, unworn or gently tried on, refund to the original payment method
after the item passes a quality check, exchanges ship once the original pair
is in. The system enforces exactly that and nothing more.

**Customer side (no login).** `POST /api/returns/request` with order number,
email, SKU, quantity, `return` or `exchange`, a reason code (no free text)
and, for an exchange, the size wanted. `POST /api/returns/lookup` shows
their requests. Both sit behind the guest order lookup (same limits, same
uniform "couldn't find" answer, same timing floor) and the ordering gate.
The form is on the Order Status page, under the tracker result of a
delivered order (copy DRAFT — owner sign-off before ordering opens).
A customer who asks by email or phone: order page → *Record a return or
exchange* (delivered orders only; `POST /api/admin/orders/[n]/returns`) —
the same checks, your note of how they asked, audit-logged. Refused automatically: an order not delivered, past
30 days, more units than bought, a second open request for the same item,
an exchange to a size priced differently (return and reorder instead).

**Operator side.** Order page → *Returns, exchanges and RTO*; everything
waiting is also on the Exceptions page.

1. **Requested → approve or reject.** Approving does not create a label:
   **return labels are not built** (needs the Shiprocket account; Shiprocket
   API is deferred). Create the return in the Shiprocket panel — see
   *Shiprocket return pickups* below — and email the customer yourself.
2. **Approved → mark received** when the parcel arrives: tick *passed
   quality check*, and *put back into sellable stock* if it can be sold
   again. Restocking happens exactly once (the step cannot be repeated) and
   is audit-logged as an inventory adjustment. A failed check closes the
   request with no refund and no replacement — tell the customer why.
3. **Return, received → Refund this return** (sign-in within 15 minutes,
   order number retyped):
   - **Every item of the order back**, and the order charged no shipping or
     COD fee → the order becomes `returned` and the order's normal **full
     refund** is queued (processed by the maintenance job once Razorpay keys
     exist; the order moves to `refunded` when Razorpay confirms it).
     *Tip: mark all parcels of an order received before refunding, or the
     first one is refunded line by line.*
   - **Anything less** (one line of several, or an order that charged
     shipping) → the line's amount (GST-inclusive unit price × units) is
     recorded **as due**. Refund exactly that amount in the Razorpay
     dashboard (the order's payment → Refund → partial), then **Record
     refund** with the `rfnd_…` id. The id is your statement — the system
     does not read it back from Razorpay — and the payment and order rows
     are not changed by a partial refund. Recorded amounts can never exceed
     the captured payment, and the order's full-refund button disappears
     once any partial refund is recorded.
   - Shipping is never refunded automatically: whether it is refunded on a
     return is not a published policy (owner decision).
4. **Exchange, received → Replacement shipped**: enter courier and AWB from
   the Shiprocket panel (create the forward shipment there by hand). The
   replacement size's stock is taken at that moment, under lock; if it sold
   out meanwhile the step is refused — restock it, or reject and handle as a
   return. No new invoice or credit note is issued for an exchange (CA
   question, with PR #38).
5. **Failed delivery:** when the courier reports it, change the status to
   `rto`. When the parcel is back, the order page shows **RTO received**:
   per item, quality check and restock. Recorded once per item. Then either
   queue the full refund (prepaid) or contact the customer. **A re-ship and
   its charge are not built** — the terms say "re-shipping charges may
   apply" but the amount is D11.

**Not built (blocked):** return labels / reverse pickup (Shiprocket
account), RTO re-ship charge (D11), COD refunds by bank transfer or store
credit (D11 + D1's ledger), credit notes for partial refunds and any
invoice for an exchange (CA review, PR #38), return/refund emails (copy not
approved; and `email_log` is `UNIQUE(order_id, template)` — one email per
order per template — so per-return emails need a migration on that live
table: a `return_id` key, deliberately not bundled into this PR).

### Shiprocket return pickups (manual, until the API trigger)

No return-order CSV export is built: Shiprocket publishes no return-order
upload header we could verify (searched 19 Oct 2026; its support articles
describe creating returns in the panel), and an invented header would be
rejected or, worse, accepted wrongly. Shiprocket's help centre describes
two panel routes:
- **From the delivered order** (preferred): Orders → *Delivered* → the order
  → create return. It reuses the forward order's address and items.
- **A manual return order** (Returns → Add return order) for anything else.

Either way, once Shiprocket assigns the reverse AWB, note it in the
approval note or the customer email; Vokr does not store reverse AWBs
(nothing reads them until the API exists). Return QC at the warehouse is
the *mark received* step above, never Shiprocket's own QC flag.

### Courier status → Vokr action (verify names against your panel)

Shiprocket's tracking labels as shown in its panel; confirm the exact
wording on the first real shipments and correct this table if it differs.

| Shiprocket shows | Do in Vokr |
|---|---|
| Pickup scheduled / Picked up / In transit / Out for delivery | Nothing — the order is already `shipped` |
| Delivered | Order → **delivered**, the same day — the 30-day window counts from when you record it, so a late entry lengthens it |
| Undelivered (attempt failed) | Nothing yet; Shiprocket re-attempts. Contact the customer if it repeats |
| RTO initiated | Order → **rto** |
| RTO delivered (back at the warehouse) | **RTO received**: per item QC + restock |
| Lost / damaged in transit | Not modelled: raise a claim in Shiprocket. Re-ship or refund is an owner decision (no published policy) |
| Return (reverse) picked up / delivered to you | The return's **mark received** when the parcel is opened and checked |

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
- Full refunds only from this button. A partial refund for a returned item
  goes through *Refund this return* (above), which records it as due.
- COD orders have no online payment to refund (COD is not built — D11).
- Refunds **never restock**. Returned and RTO items are restocked by the
  *received* step; anything else, adjust stock.
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
