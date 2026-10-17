# Alerting

Plan §5 Phase 15. The application logs a fixed tag at error/warn level for
every condition that needs a person. `scripts/ops/setup-log-alerts.sh`
turns each tag into a Cloud Logging **log-based metric** (a counter), and —
given a notification channel — one Cloud Monitoring **alert policy** per
metric (fires when the count is above 0 in 5 minutes; auto-closes after a
day).

## State (17 Oct 2026)

- **Metrics: created** in `vokr-website` (the first ten below).
  `vokr_form_delivery_failed` (17 Oct 2026) is defined in the script but
  **not yet created** — the owner re-runs the script to add it. Its filter is
  checked only against the line the unit tests pin (`FORM_DELIVERY_FAILED`
  in `src/server/marketing/__tests__/`), not yet against live logs. The
  first ten filters were checked against the exact string their code path
  emits, and the filter shape against live logs. Filters are substring matches on log text: **when a
  tagged log line changes, update the script and re-run it.**
- **Alert policies: not created — no notification channel exists.** The
  owner chooses where alerts go. To turn them on:

```bash
gcloud beta monitoring channels create --project vokr-website \
  --type=email --display-name="Vokr ops" --channel-labels=email_address=<your inbox>
gcloud beta monitoring channels list --project vokr-website   # copy the channel name/ID
bash vokr/scripts/ops/setup-log-alerts.sh --channel <channel ID>
```

Re-running the script is safe (it updates metrics and skips existing
policies).

## What each alert means

| Metric | Fires when | Do this |
|---|---|---|
| `vokr_order_orphan` | A paid session has no order, a captured payment has neither order nor refund issue, or a prepaid order has no capture | Urgent: money and orders disagree. Admin → Exceptions; `late-payments.md` |
| `vokr_late_payment_manual_review` | A payment issue opens in, or moves to, manual review — a late/extra payment the job will not decide alone, a failed refund, an amount mismatch | Admin → Exceptions → payment issue `last_error`; act in the Razorpay dashboard (`late-payments.md`) |
| `vokr_unmatched_payment` | Razorpay reports money on an order this server has no record of | Check the Razorpay dashboard; never auto-refunded (`late-payments.md`) |
| `vokr_amount_mismatch` | A payment's amount does not match its order (`reason=amount_mismatch`), or such an issue could not even be recorded (`AMOUNT_MISMATCH_UNRECORDED` — urgent) | Never auto-refunded; check in Razorpay and refund by hand |
| `vokr_reconcile_failed` | Razorpay could not be read for an order during reconciliation | Transient if it clears next run; persistent → Razorpay keys/status |
| `vokr_email_failed` | A transactional email failed, or Brevo refused the account (queue paused) | `email.md`; Admin → Exceptions → failed emails; check the Brevo key/sender |
| `vokr_form_delivery_failed` | The contact or newsletter form could not be delivered to Brevo (`reason` = `rejected` with Brevo's `status`/`code`, `timeout`, `network`, `not_configured`, `unexpected`) — the visitor saw an error | `brevo.md` → Failure behaviour. 401/403 or `not_configured`: key/IP/sender, every submission fails until fixed. `timeout`/`network`/5xx: Brevo side; act if it persists |
| `vokr_email_volume` | 200 emails today (warning) or 290 (sending stopped for the day) | Brevo free tier is 300/day; upgrade if this recurs (`email.md`) |
| `vokr_credit_note_failed` | A GST credit note could not be issued (after the invoices release) | Admin → Exceptions → refunded invoices without a credit note |
| `vokr_admin_gate_error` | The admin gate failed for a reason other than "not an admin" | The panel may be unreachable for admins: check logs for the error, DB/Supabase health |
| `vokr_maintenance_not_ok` | A maintenance run (every 5 min) did not finish cleanly | Read the run's JSON report in the log line; the failing step names itself |

Not covered here (separate, by design): uptime checks on `/api/health`,
billing budget alerts (R4, set up in Billing), and Brevo/Razorpay
dashboard-side alerts.
