# Alerting

Plan §5 Phase 15. The application logs a fixed tag at error/warn level for
every condition that needs a person. `scripts/ops/setup-log-alerts.sh`
turns each tag into a Cloud Logging **log-based metric** (a counter), and —
given a notification channel — one Cloud Monitoring **alert policy** per
metric (fires when the count is above 0 in 5 minutes; auto-closes after a
day).

## State (19 Oct 2026)

- **Metrics: 10 created** in `vokr-website` (verified read-only with
  `gcloud logging metrics list`, 19 Oct 2026). **Defined but not yet created:**
  `vokr_form_delivery_failed`, `vokr_maintenance_finished` and (19 Oct,
  backups branch) `vokr_backup_failed`, `vokr_backup_ok` — the backup pair
  counts the workflow's own `vokr-backup` log on the `global` resource. The
  owner re-runs `setup-log-alerts.sh` to add them.
- **Alert policies and the uptime check: defined as code, not created.**
  There's one file per policy in `scripts/ops/alert-policies/`, and
  `scripts/__tests__/alert-policies.test.ts` checks them offline:
  - every metric has exactly one well-formed policy;
  - each money-disagreement alert is CRITICAL;
  - every log tag a metric matches is still written by the code;
  - every alert has a matching test-fire line.

  Nothing is created until a notification channel exists. **The owner
  chooses where alerts go, and it must be an inbox someone actually reads.**
  A verified Brevo sender proves nothing about a mailbox.
- **Known gap:** `CREDIT_NOTE_FAILED` is written only by unmerged PR #38, so
  `vokr_credit_note_failed` cannot fire until the invoices release. The test
  records this as a pending-release entry that fails once #38 lands.

Filters are substring matches on log text. **When a tagged log line
changes, update `setup-log-alerts.sh` and re-run it.** The offline test
fails if a tag disappears from the source.

## Turning alerts on (owner)

```bash
gcloud beta monitoring channels create --project vokr-website   --type=email --display-name="Vokr ops" --channel-labels=email_address=<inbox someone reads>
gcloud beta monitoring channels list --project vokr-website      # copy the channel ID
bash vokr/scripts/ops/apply-alert-policies.sh                    # dry run: validates, prints the plan
bash vokr/scripts/ops/setup-log-alerts.sh --channel <channel ID> # metrics, then policies + uptime check
```

Both scripts are idempotent. An existing metric is updated in place. An
existing policy or uptime check (same display name) is skipped and never
changed: edit it in the console, or delete it and re-run.

## Thresholds and severity

Every count-based policy uses a 5-minute sum above 0, except where stated.
Each auto-closes after 24 h.

| Policy | Severity | Fires when | Why this threshold |
|---|---|---|---|
| `vokr_order_orphan` | CRITICAL | > 0 in 5 min | Money and orders disagree |
| `vokr_unmatched_payment` | CRITICAL | > 0 in 5 min | Money this server has no record of |
| `vokr_amount_mismatch` | CRITICAL | > 0 in 5 min | Never auto-refunded |
| `vokr_late_payment_manual_review` | ERROR | > 0 in 5 min | The job will not decide alone |
| `vokr_email_failed` | ERROR | > 0 in 5 min | A customer missed an email |
| `vokr_form_delivery_failed` | ERROR | > 0 in 5 min | A visitor saw an error |
| `vokr_credit_note_failed` | ERROR | > 0 in 5 min | A GST record is missing |
| `vokr_admin_gate_error` | ERROR | > 0 in 5 min | Admins may be locked out |
| `vokr_maintenance_not_ok` | ERROR | > 0 in 5 min | A run's report names the failing step |
| `vokr_reconcile_failed` | WARNING | **> 1 in 15 min** | "Transient if it clears next run" (below): needs two failures across three runs |
| `vokr_email_volume` | WARNING | > 0 in 5 min | 200/day warning, 290/day stop (free tier is 300) |
| `vokr_backup_failed` | ERROR | > 0 in 5 min | A scheduled database backup failed; nothing it left counts as a backup |
| `vokr_backup_absent` | ERROR | **no verified backup for 8 h** | Schedule is 6 h; GitHub can delay scheduled runs or disable them after 60 days without repository activity |
| `vokr_maintenance_absent` | ERROR | **no finished run for 20 min** | The Scheduler runs every 5 min. Four missed runs means it or the service stopped, and holds stop expiring |
| `uptime /api/health` | CRITICAL | **failing from ≥ 2 regions for 5 min** | `https://vokr.shop/api/health` (through Cloudflare) every 5 min. Two regions rule out one checker's network |

Uptime checks are free within Cloud Monitoring's monthly allowance. 5 min ×
the default regions is about 50k checks a month. If the Cloudflare
bot/WAF rules (Phase 20) ever challenge Google's checkers, the uptime alert
fires: allow-list `/api/health` for them.

## Test-fire (observe every alert once)

1. **Log-based alerts (12 lines):** `bash vokr/scripts/ops/test-fire-alerts.sh`
   prints the plan. `--apply` writes one synthetic `ALERT-TEST …` log line
   per metric (two for `vokr_reconcile_failed`), under the `vokr` service's
   resource labels. That's a production logging write, for the owner. It
   doesn't touch the app, database, Razorpay or Brevo. Every alert should
   arrive within about 5 minutes. Tick each one off, then close them or let
   them auto-close. `--apply vokr_email_failed` fires just one.
2. **`vokr_maintenance_absent`:** pause the Scheduler job
   (`gcloud scheduler jobs pause vokr-maintenance --location asia-south1 --project vokr-website`),
   wait for the alert (about 20–25 min), then **resume it**
   (`… jobs resume vokr-maintenance …`). Do this only while ordering is off,
   because holds don't expire while it's paused.
3. **Uptime:** in the console, edit the `vokr-health` check's path to
   `/api/health-alert-test` (a 404). Wait for the alert (5–10 min), then
   change it back.

Record each fire (time received, channel) in the plan's Phase 15 Status.

## What each alert means

| Metric | Fires when | Do this |
|---|---|---|
| `vokr_order_orphan` | A paid session has no order, a captured payment has neither order nor refund issue, or a prepaid order has no capture | Urgent: money and orders disagree. Admin → Exceptions; `late-payments.md` |
| `vokr_late_payment_manual_review` | A payment issue opens in, or moves to, manual review — a late/extra payment the job will not decide alone, a failed refund, an amount mismatch | Admin → Exceptions → payment issue `last_error`; act in the Razorpay dashboard (`late-payments.md`) |
| `vokr_unmatched_payment` | Razorpay reports money on an order this server has no record of | Check the Razorpay dashboard; never auto-refunded (`late-payments.md`) |
| `vokr_amount_mismatch` | A payment's amount does not match its order (`reason=amount_mismatch`), or such an issue could not even be recorded (`AMOUNT_MISMATCH_UNRECORDED` — urgent) | Never auto-refunded; check in Razorpay and refund by hand |
| `vokr_reconcile_failed` | Razorpay could not be read for an order during reconciliation | Transient if it clears next run; persistent → Razorpay keys/status |
| `vokr_email_failed` | A transactional email failed, or Brevo refused the account (queue paused) | `email.md`; Admin → Exceptions → failed emails; check the Brevo key/sender |
| `vokr_form_delivery_failed` | The contact or newsletter form could not be delivered to Brevo (`reason` = `rejected` with Brevo's `status`/`code`, `timeout`, `network`, `not_configured`, `recipient_blocked`, `unconfirmed`, `unexpected`) — the visitor saw an error | `brevo.md` → Failure behaviour. 401/403 or `not_configured`: key/IP/sender, every submission fails until fixed. `timeout`/`network`/5xx: Brevo side; act if it persists. `recipient_blocked`: `support@` is on Brevo's blocklist — fix the Zoho mailbox, then unblock (`brevo.md`) |
| `vokr_email_volume` | 200 emails today (warning) or 290 (sending stopped for the day) | Brevo free tier is 300/day; upgrade if this recurs (`email.md`) |
| `vokr_credit_note_failed` | A GST credit note could not be issued (after the invoices release) | Admin → Exceptions → refunded invoices without a credit note |
| `vokr_admin_gate_error` | The admin gate failed for a reason other than "not an admin" | The panel may be unreachable for admins: check logs for the error, DB/Supabase health |
| `vokr_maintenance_not_ok` | A maintenance run (every 5 min) did not finish cleanly | Read the run's JSON report in the log line; the failing step names itself |

| `vokr_backup_failed` | A run of the `Database backup` workflow failed (dump, encryption, upload or read-back) | Open the run URL in the log line; `backups.md` |
| `vokr_backup_absent` | No `BACKUP_OK` for 8 h | `BACKUP_ENABLED` off, workflow disabled by GitHub (60 days inactive), WIF/Secret Manager access, or every run failing early — Actions → Database backup; `backups.md` |
| `vokr_maintenance_absent` | No maintenance run finished for 20 min | Scheduler job `vokr-maintenance` paused/failing, or the service is down: `gcloud scheduler jobs describe vokr-maintenance --location asia-south1 --project vokr-website`, then the service logs |
| `uptime /api/health` | The public health endpoint fails from ≥ 2 regions | Storefront likely down: Cloud Run revision status, Cloudflare, Supabase |

Not covered here (separate, by design): billing budget alerts (R4, set up
in Billing), and Brevo/Razorpay dashboard-side alerts.
