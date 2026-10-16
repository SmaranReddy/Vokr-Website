# Transactional email (order confirmation)

Plan §5 Phase 11. Code: `src/server/email/` (`brevo.ts` client, `outbox.ts`,
`templates/order-confirmation.ts`); table `email_log` (migration
`20261016171356_email_log`).

## How it works
1. **Enqueue.** When a verified capture creates an order, an `email_log` row
   (`order_confirmation`, `pending`) is written in the same transaction.
   `UNIQUE(order_id, template)` means one confirmation per order, even when a
   webhook is replayed.
2. **Send.** The maintenance job (every 5 minutes) sends pending rows after
   commit, so an email can never fail or delay a payment. Confirmation
   therefore arrives within about 5 minutes of payment.
   - **No double send.** A row is claimed `pending → sending` by a
     conditional update, so overlapping runs cannot both send it. Every send
     also carries the row id as Brevo's `idempotencyKey` (in the request
     body's `headers`). A retry after a timeout, or a re-queued crashed send,
     is therefore refused by Brevo as `duplicate_parameter` and treated as
     already sent. The 15-minute window comes from the 2021 changelog; current
     docs say 30. This is documented behaviour, not yet verified against a
     live account.
   - **Retries.** A retryable failure (network, timeout, 429, 5xx) goes back
     to `pending` and becomes `failed` after 5 attempts. A per-message 4xx is
     `failed` at once.
   - **Account problems pause the queue.** A 401 or 403 (bad key, unverified
     sender) puts the row back to `pending` without spending an attempt and
     stops the batch. Nothing is lost while a person fixes the account.
   - **Crashed sends.** A row stuck in `sending` for more than 3 minutes is
     re-queued if it is still inside 12 minutes, because the same key makes
     the resend safe. Older ones are `failed` for a person.
   - **Bounded run.** The step stops claiming after 30 s, and each send times
     out at 5 s, so the job stays inside Scheduler's 90 s deadline. Unclaimed
     rows wait for the next run.
3. **Volume.** A warning is logged at 200 sends a day (India time). Sending
   stops at 290; the remaining emails wait for the next day. Brevo's free tier
   allows 300 a day.
4. **Privacy.** The address is decrypted only to send. The row keeps only a
   SHA-256 of it. The body is never stored.

Without `BREVO_API_KEY` the step reports `not_configured`, and pending emails
wait safely until a key is added.

## Watching it
- Log tags: `EMAIL_FAILED` (a failed row, sends abandoned past the dedup window, or an account-level refusal that paused the queue) and `EMAIL_VOLUME`
  (200 warning, 290 stop). The maintenance report's `emails` step gives
  counts only.
- Read-only query: `SELECT status, count(*) FROM email_log GROUP BY status;`
- A `failed` row needs a person: check the order and resend by hand if
  appropriate.

## Before ordering opens (owner)
- **The copy is a DRAFT** (`templates/order-confirmation.ts`): factual only,
  with no delivery-time or invoice promises. It needs owner sign-off.
- **Brevo key and sender:** see `brevo.md`. **Verify `support@vokr.shop` as
  a sender (or authenticate the domain) before adding the key.** A wrong
  sender only pauses the queue, but nothing sends until it is fixed. Then
  mount `BREVO_API_KEY` (gated on `BREVO_API_KEY_READY` in `deploy.yml`).
- **PDF item 9:** send yourself a real confirmation and check whether
  free-plan mail carries Brevo branding.
- Not built yet: shipped, delivered, cancelled and refund emails (Phase 10
  status changes), the Brevo bounce/delivery webhook (task 7), and an admin
  view of failures (Phase 12).
