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

## What the code does

1. **Recording, in the payment-apply transaction.** This runs for a webhook and for reconciliation alike.
   - When an `authorized` or `captured` arrives for a session holding no stock, the session is never marked `paid` and stock is never touched.
   - If the session was still `payment_pending`, it moves to `expired`.
   - One `payment_issues` row opens, in state `open`. `UNIQUE(payment_id)` makes duplicates and races converge on one row.
2. **Resolving, in the maintenance job's `latePayments` step,** every 5 minutes. No network call runs inside a transaction.
   - It reads the payment from Razorpay.
   - `authorized`: it waits. Razorpay either captures it or auto-refunds it.
   - `captured`: it lists the payment's refunds and adopts its own, matched by receipt. Only if none exists does it create one full refund, with `X-Refund-Idempotency` and a receipt both set to `vokr_late_<razorpay payment id>` and an identical body on every retry.
   - Razorpay also refuses to refund beyond the captured amount.
   - When the refund is `processed`, or a `refund.processed` webhook arrives, the payment becomes `refunded` and the issue is `refunded`.
3. **`manual_review`.** The job stops and logs at error level when it sees:
   - a partial refund, or one it did not make;
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
2. Refund there if that is the decision. A full refund shows up as a `refund.processed` webhook, which moves the payment to `refunded`; the issue itself stays `manual_review`.
3. Close the issue with a recorded reason. There is no admin UI yet (Phase 12), so this is a deliberate, reviewed SQL statement against production, run by the owner:
   `UPDATE payment_issues SET state = 'refunded', resolved_at = now(), last_error = '<who, why>' WHERE id = '<id>' AND state = 'manual_review';`
   Use it only for a full refund. For anything else, leave the row in `manual_review` and track it outside the database.

## Decisions left to the owner (plan §0.3)

- **Auto-refund policy.** The job refunds every late capture in full, automatically. The alternative is to fulfil it when stock is still free, which means re-reserving at the original price. That alternative is not built.
- **Razorpay capture window.** The capture settings, or the order's `capture_options`, can make Razorpay itself auto-refund authorizations after a chosen window (minimum 12 minutes). That would stop most late captures from happening at all. It is not configured.
