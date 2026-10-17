# Parked: Razorpay and payment work

**Parked 17 Oct 2026 (owner instruction):** finish every non-payment task
first. Nothing in this list may be "completed" by weakening a gate. While
parked:

- `ORDERING_ENABLED = false` (`src/config/commerce.ts`) and
  `RAZORPAY_LIVE_MODE_ALLOWED = false` (`src/server/payments/config.ts`) stay
  as they are. Both are reviewed code changes, never config.
- The existing payment code, its safeguards and its tests stay. CI keeps
  running them, and other work must keep them green.
- No Razorpay credentials are requested, no webhook is registered, and no
  payment staging is built.

Resume from the top. Each item names its evidence target (plan §6 R-row or
phase task).

## 1. Owner inputs (needed before any engineering)

| # | Input | Unblocks |
|---|---|---|
| P1 | Razorpay **test-mode** key id + key secret (`rzp_test_…`) | everything in §2 |
| P2 | Razorpay webhook secret (test), and the webhook URL registered in the Razorpay dashboard | R7 sandbox evidence, order creation |
| P3 | **D3**: legal entity, GSTIN, registered address, KYC documents | R16 live mode, invoices (R11) |
| P4 | **D12**: confirm automatic full refund of late captures (implemented), and decide the Razorpay auto-capture window (≥ 12 min; not configured) | late-payment policy sign-off |
| P5 | **D11**: COD fee and flat shipping fee, or "prepaid only" | COD lifecycle (Phase 10 tasks 5, 9) and pricing config |
| P6 | Approval to create an isolated **staging** environment (R5): a separate Cloud Run service not named `vokr-…`, its own database, and test keys only | the R10 round trip, R5 |

## 2. Engineering, once P1–P2 exist

1. **R5 staging + boot assertion.** Separate service and database, plus a
   startup check that refuses live keys outside production.
2. **Sandbox payment matrix** (Phase 7): success, failure, user cancel,
   retry after failure, double click on Pay, webhook arriving before or after
   the client callback, duplicate webhook, out-of-order webhooks, signature
   mismatch → R7 and R8 sandbox evidence.
3. **Refund matrix:** admin full refund through `payment_issues`, a late
   capture refunded in full (`late-payments.md`), and a partial refund made in
   the dashboard reconciled to `manual_review`. Returns from PR #49 record
   partial amounts as `manual_due`, so add the operator check that a recorded
   refund id exists in Razorpay.
4. **R10 payment round trip over HTTP** (`load-tests/checkout-concurrency.js`):
   add the `POST /api/payments/razorpay/order` and webhook steps. Prove zero
   duplicate orders and payment/order consistency at 10/25/50 × 3, against
   staging.
5. **Phase 21 task 5:** the injected Razorpay delay, proving the call sits
   outside the inventory lock (lock wait must not track the delay).
6. **R10 on Cloud Run:** rerun both k6 scenarios on staging. The local
   numbers (`docs/performance/results.md`) are a lower bound only.
7. **R16 live mode:** after D3 KYC, the reviewed flip of
   `RAZORPAY_LIVE_MODE_ALLOWED`, done together with the launch gate (§13),
   never before.
8. **Opening ordering:** the reviewed flip of `ORDERING_ENABLED`, last, after
   every §13 item is VERIFIED and the owner authorizes it.

## 3. Already built and tested without Razorpay (do not redo)

- Webhook HMAC verification over the raw body, constant-time (R7, faked provider).
- Idempotency keys for checkout sessions and payments (R8).
- Reservation in one DB transaction, with Razorpay never called inside it (R9,
  architecture test).
- Late-payment full refund and reconciliation job, payment issues, and the
  exceptions page.
- R10 reservation path over real HTTP, locally: 10/25/50 × 3, plus the
  retry/partial-rollback scenario (PR #48, `docs/performance/results.md`).
- Admin full refund queue (Phase 12), and the partial-refund cap for returns (PR #49).
