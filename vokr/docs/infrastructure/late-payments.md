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
2. **Finding them without a webhook.** In the `reconciliation` step, every order created in the last 4 days whose session is no longer `payment_pending` is re-read from Razorpay at most every 30 minutes (`payments.late_checked_at`). Every `authorized` or `captured` attempt is applied through the same path a webhook uses. A payment's `refunded` summary status is never taken as proof. It can be set while the refund is still pending, so an issue closes only from refund entities or a `refund.processed` webhook.
3. **Resolving, in the maintenance job's `latePayments` step,** every 5 minutes. No network call runs inside a transaction.
   - It reads the payment from Razorpay.
   - `authorized`: it waits. Razorpay either captures it or auto-refunds it.
   - `captured`: it lists the payment's refunds and adopts its own, matched by receipt or by the refund id it recorded. Only if none exists does it create one full refund, with `X-Refund-Idempotency` and a receipt both set to `vokr_late_<razorpay payment id>` and an identical body on every retry.
   - Razorpay also refuses to refund beyond the captured amount.
   - It waits on a full refund someone else started, such as Razorpay's auto-refund or the dashboard.
   - When processed refunds cover the amount, or a `refund.processed` webhook arrives, the issue is `refunded`. The order's payment row moves to `refunded` only when the refunded payment is the order's own.
4. **`manual_review`.** The job stops and logs at error level when it sees:
   - a partial refund it did not make;
   - an unknown payment status;
   - an amount mismatch;
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

**Not created yet; needs authorisation.** A log-based alert on
`textPayload:"LATE_PAYMENT manual_review"` (and on `"LATE_PAYMENT opened"`,
if every late payment should page) belongs with Phase 15 observability. It
is production infrastructure.

Open issues, read-only:

```sql
SELECT state, reason, provider_payment_id, amount_paise, refund_id, attempts, last_error, created_at
  FROM payment_issues WHERE state IN ('open', 'refund_initiated', 'manual_review') ORDER BY created_at;
```

## Resolving `manual_review` by hand

1. Look at the payment in the Razorpay dashboard. Its refunds, `amount_refunded` and status are the truth.
2. Decide there, and refund there if that is the decision.
3. Nothing needs to be written to the database. The job keeps watching `manual_review` issues: once processed refunds cover the amount, it closes the issue (`refunded`), and so does a `refund.processed` webhook. An issue that should stay unrefunded stays in `manual_review`. A resolution state for that belongs with the Phase 12 admin tools.

## Decisions left to the owner (plan §0.3)

- **Auto-refund policy.** The job refunds every late capture in full, automatically. The alternative is to fulfil it when stock is still free, which means re-reserving at the original price. That alternative is not built.
- **Razorpay capture window.** The capture settings, or the order's `capture_options`, can make Razorpay itself auto-refund authorizations after a chosen window (minimum 12 minutes). That would stop most late captures from happening at all. It is not configured.
