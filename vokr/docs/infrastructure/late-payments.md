# Late payments: money for stock no longer held

Plan §5 Phase 8, Open 5. Code: `src/server/payments/apply.ts`,
`payment-issues.ts`, `late-payment.ts`; tests:
`src/server/payments/__tests__/late-capture.integration.test.ts`.

## When it happens

A Razorpay Checkout modal opened before a hold lapsed stays usable in the
browser. Razorpay also polls banks for up to 3 days, so a UPI or netbanking
payment can authorize late. By default Razorpay auto-captures anything
authorized within 3 days. Either way, money can arrive after the
maintenance job released the stock and the session became `expired`.

A customer can also pay twice on one Razorpay order. For example, a UPI
attempt is still pending when they retry by card, and the UPI one authorizes
later. The order is then paid once, and the second payment is extra money.

## What the code does

1. **Recording, in the payment-apply transaction.** This runs for a webhook and for reconciliation alike.
   - When an `authorized` or `captured` arrives for a session holding no stock, the session is never marked `paid` and stock is never touched.
   - If the session was still `payment_pending`, it moves to `expired`.
   - One `payment_issues` row opens, in state `open`. It is keyed by the Razorpay payment id: `UNIQUE(provider_payment_id)` makes duplicates and races converge on one row.
   - A second payment (a different `pay_…`) on an order already `captured` or `refunded` opens its own issue (`additional_payment`). The order keeps its first payment, its `paid` state and its stock, and refunding the second payment never touches the order's row.
   - An `authorized` or `captured` for an amount that does not match the order is refused (the order is never paid by it) and opens an issue straight in `manual_review` (`amount_mismatch`) for the amount Razorpay actually holds. The job never refunds it on its own; it watches it like any other `manual_review` issue.
   - An `authorized` or `captured` on a Razorpay order this server has no record of is **not** refunded: it may be another integration's money on the same account. It is logged at error level with the tag `UNMATCHED_PAYMENT`, and its redacted webhook row keeps `processing_error` set. Pruning never deletes a webhook row with `processing_error` set. That keeps these indefinitely, and also rows that only carried a warning (late or additional payments, which have their own `payment_issues` row); nothing marks such a row as dealt with yet (Phase 12). The rows hold no customer contact data.
2. **Finding them without a webhook.** In the `reconciliation` step, every order created in the last 4 days whose session is no longer `payment_pending` is re-read from Razorpay at most every 30 minutes (`payments.late_checked_at`). Every `authorized` or `captured` attempt is applied through the same path a webhook uses. One order Razorpay cannot read is logged (`RECONCILE_FAILED`), counted in `reconciliation.result.errors` and stamped as checked, so it goes to the back of the queue instead of blocking every later batch; the run reports `ok=false` so Scheduler retries and it is visible. The same per-order isolation applies to `payment_pending` reconciliation.

   **A payment's `refunded` summary status is never taken as proof**, anywhere: it can be set while the refund is still pending, and for an authorization released without capture. Reconciliation never applies it; an issue closes only from processed refund entities (listed by the API) or a `refund.processed` webhook whose refund entity is `processed`, belongs to that payment and covers its whole amount.
3. **Resolving, in the maintenance job's `latePayments` step,** every 5 minutes. No network call runs inside a transaction.
   - It reads the payment from Razorpay.
   - `authorized`: it waits. Razorpay either captures it or auto-refunds it.
   - `captured`: it lists the payment's refunds and adopts its own, matched by receipt or by the refund id it recorded. Only if none exists does it create one full refund, with `X-Refund-Idempotency` and a receipt both set to `vokr_late_<razorpay payment id>` and an identical body on every retry.
   - Razorpay also refuses to refund beyond the captured amount.
   - It waits on a full refund someone else started, such as Razorpay's auto-refund or the dashboard.
   - When processed refunds cover the amount, or a `refund.processed` webhook carries a processed refund entity for the whole amount, the issue is `refunded`. The order's payment row moves to `refunded` only when the refunded payment is the order's own.
   - Razorpay reports `refunded` but lists no refund entity: `manual_review` (still watched; it closes on its own if a processed refund appears).
4. **`manual_review`.** The job stops and logs at error level when it sees:
   - a partial refund it did not make;
   - an unknown payment status;
   - an amount mismatch;
   - a `refunded` summary with no refund entity;
   - a failed refund;
   - 5 consecutive API errors.

   A 409 (request still in progress) is retried on the next run and is not counted as an error.

Without Razorpay keys the step reports `not_configured`. Issues stay `open`;
nothing is refunded and nothing is lost.

## Watching it

Every transition is logged with the tag `LATE_PAYMENT`:

```text
[payments] LATE_PAYMENT opened|refund created|manual_review|refunded payment=<uuid> razorpay_payment=<pay_…> …
```

The maintenance report's `latePayments.result.totals` counts every issue by
state. `open` and `manual_review` above zero mean money is waiting on the
job or on a person.

**Not created yet; needs authorisation.** Log-based alerts on
`textPayload:"LATE_PAYMENT manual_review"`, `"UNMATCHED_PAYMENT"` and
`"RECONCILE_FAILED"` (and on `"LATE_PAYMENT opened"`, if every late payment
should page) belong with Phase 15 observability. They are production
infrastructure.

Unmatched payments, read-only:

```sql
SELECT received_at, event_type, payload->'payment'->>'order_id' AS razorpay_order,
       payload->'payment'->>'id' AS razorpay_payment, payload->'payment'->>'amount' AS amount, processing_error
  FROM webhook_events WHERE processing_error LIKE 'no local payment%' ORDER BY received_at;
```

Open issues, read-only:

```sql
SELECT state, reason, provider_payment_id, amount_paise, refund_id, attempts, last_error, created_at
  FROM payment_issues WHERE state IN ('open', 'refund_initiated', 'manual_review') ORDER BY created_at;
```

## Resolving `manual_review` by hand

1. Look at the payment in the Razorpay dashboard. Its refunds, `amount_refunded` and status are the truth.
2. Decide there, and refund there if that is the decision.
3. Nothing needs to be written to the database. The job keeps watching `manual_review` issues: once processed refunds cover the amount, it closes the issue (`refunded`), and so does a `refund.processed` webhook. An issue that should stay unrefunded stays in `manual_review`. A resolution state for that belongs with the Phase 12 admin tools.

**Known limitations** (none oversells; each can leave units reserved or the job red until a person acts):

- An amount-mismatched capture that is the order's only attempt keeps the session's stock hold: the expiry job releases a hold only when every attempt Razorpay lists is `failed`. Resolution needs Phase 12 admin tooling.
- A `payment_pending` session whose payment is `authorized` locally, and whose authorization Razorpay later auto-refunds without capture, keeps its hold the same way: the expiry job keeps any hold with a local `authorized` payment or a non-`failed` remote attempt. (Pre-existing; not introduced by the reconciliation hardening.)
- A `payment_pending` order Razorpay permanently refuses to read never ages out of reconciliation (closed orders age out after 4 days), so every run reports `ok=false` and returns 500 until a person resolves it. Scheduler retries once (`retryCount: 1`), so it at most doubles that order's reads. Because the job is then permanently red, **Phase 15 alerts must key on the `RECONCILE_FAILED` log tag (and count distinct payments), not on the job's HTTP status**, or a second failure would hide behind the first. A per-payment failure counter would fix this properly but needs a migration.
- A mismatched capture in a currency other than INR cannot be stored in `payment_issues` (INR-only CHECK); it is logged as `AMOUNT_MISMATCH_UNRECORDED` and kept on its webhook row.
- Whether Razorpay lists a refund entity when it auto-refunds an uncaptured authorization is **unverified** (no test keys). If it does not, each such case lands in `manual_review` — correct under the owner's rule, but manual work.

## Decisions left to the owner (plan §0.3)

- **Auto-refund policy.** The job refunds every late capture in full, automatically. The alternative is to fulfil it when stock is still free, which means re-reserving at the original price. That alternative is not built.
- **Razorpay capture window.** The capture settings, or the order's `capture_options`, can make Razorpay itself auto-refund authorizations after a chosen window (minimum 12 minutes). That would stop most late captures from happening at all. It is not configured.
