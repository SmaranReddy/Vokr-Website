#!/usr/bin/env bash
# Log-based alerting for Vokr (plan §5 Phase 15). Idempotent.
#
#   bash scripts/ops/setup-log-alerts.sh                 # metrics only (safe, no notifications)
#   bash scripts/ops/setup-log-alerts.sh --channel <ID>  # + the alert policies (apply-alert-policies.sh --apply)
#
# <ID> is a Cloud Monitoring notification channel, e.g. created with
#   gcloud beta monitoring channels create --project vokr-website \
#     --type=email --display-name="Vokr ops" --channel-labels=email_address=<you>
# and listed with `gcloud beta monitoring channels list --project vokr-website`.
#
# Each metric counts log lines carrying a tag the application already
# writes at error/warn level (see docs/infrastructure/alerting.md). No log
# content beyond the match is used; no personal data is involved.
set -euo pipefail

PROJECT=vokr-website
SERVICE=vokr
CHANNEL=""
if [ "${1:-}" = "--channel" ]; then CHANNEL="${2:?channel id required}"; fi

BASE="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\""

# name | log filter (appended to BASE) | description
METRICS=(
  "vokr_order_orphan|textPayload:\"ORDER_ORPHAN\"|Paid session without order, captured payment unaccounted, or prepaid order without capture"
  "vokr_late_payment_manual_review|textPayload:\"LATE_PAYMENT\" AND textPayload:\"manual_review\"|A payment issue opened in, or moved to, manual review (late/extra payment, failed refund, amount mismatch)"
  "vokr_unmatched_payment|textPayload:\"UNMATCHED_PAYMENT\"|Razorpay money on an order this server has no record of"
  "vokr_amount_mismatch|(textPayload:\"reason=amount_mismatch\" OR textPayload:\"AMOUNT_MISMATCH_UNRECORDED\")|A payment whose amount does not match its order (issue opened in manual review, or could not be recorded)"
  "vokr_reconcile_failed|textPayload:\"RECONCILE_FAILED\"|An order Razorpay could not be read for during reconciliation"
  "vokr_email_failed|textPayload:\"EMAIL_FAILED\"|A transactional email failed or the Brevo account refused the queue"
  "vokr_form_delivery_failed|textPayload:\"FORM_DELIVERY_FAILED\"|The contact or newsletter form could not be delivered to Brevo (rejected, timeout, network, not configured)"
  "vokr_email_volume|textPayload:\"EMAIL_VOLUME\"|Daily email volume reached the 200 warning or the 290 stop"
  "vokr_credit_note_failed|textPayload:\"CREDIT_NOTE_FAILED\"|A GST credit note could not be issued"
  "vokr_admin_gate_error|textPayload:\"ADMIN_GATE_ERROR\"|The admin gate failed for a reason other than not-an-admin"
  "vokr_maintenance_not_ok|textPayload:\"[jobs/maintenance] finished ok=false\"|A maintenance run (every 5 min) did not finish cleanly"
  "vokr_maintenance_finished|textPayload:\"[jobs/maintenance] finished ok=\"|Every finished maintenance run; its absence (vokr_maintenance_absent policy) means the Scheduler or service stopped"
)

# The backup workflow (.github/workflows/backup.yml) runs in GitHub Actions,
# not Cloud Run: it writes its heartbeat with `gcloud logging write
# vokr-backup …`, which lands on the `global` resource in its own log.
JOB_BASE="logName=\"projects/$PROJECT/logs/vokr-backup\""
JOB_METRICS=(
  "vokr_backup_failed|textPayload:\"BACKUP_FAILED\"|A scheduled database backup run failed (dump, encryption, upload or read-back verification)"
  "vokr_backup_ok|textPayload:\"BACKUP_OK\"|Every verified backup (COMPLETE marker read back); its absence (vokr_backup_absent policy) means backups stopped"
)

upsert() { # name base filter description
  if gcloud logging metrics describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud logging metrics update "$1" --project "$PROJECT" --description="$4" --log-filter="$2 AND $3" >/dev/null
    echo "updated metric $1"
  else
    gcloud logging metrics create "$1" --project "$PROJECT" --description="$4" --log-filter="$2 AND $3" >/dev/null
    echo "created metric $1"
  fi
}
for entry in "${METRICS[@]}"; do
  IFS='|' read -r name filter description <<<"$entry"
  upsert "$name" "$BASE" "$filter" "$description"
done
for entry in "${JOB_METRICS[@]}"; do
  IFS='|' read -r name filter description <<<"$entry"
  upsert "$name" "$JOB_BASE" "$filter" "$description"
done

if [ -z "$CHANNEL" ]; then
  echo "Metrics in place. Re-run with --channel <ID> to add alert policies."
  exit 0
fi

# Policies (and the /api/health uptime check) are defined one per file in
# scripts/ops/alert-policies/ and created by apply-alert-policies.sh.
exec bash "$(dirname "$0")/apply-alert-policies.sh" --apply --channel "$CHANNEL"
