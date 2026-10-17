#!/usr/bin/env bash
# Log-based alerting for Vokr (plan §5 Phase 15). Idempotent.
#
#   bash scripts/ops/setup-log-alerts.sh                 # metrics only (safe, no notifications)
#   bash scripts/ops/setup-log-alerts.sh --channel <ID>  # + one alert policy per metric
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
  "vokr_late_payment_manual_review|textPayload:\"LATE_PAYMENT manual_review\"|A late/extra payment the refund job will not decide alone"
  "vokr_unmatched_payment|textPayload:\"UNMATCHED_PAYMENT\"|Razorpay money on an order this server has no record of"
  "vokr_amount_mismatch|textPayload:\"AMOUNT_MISMATCH\"|A payment whose amount does not match its order"
  "vokr_reconcile_failed|textPayload:\"RECONCILE_FAILED\"|An order Razorpay could not be read for during reconciliation"
  "vokr_email_failed|textPayload:\"EMAIL_FAILED\"|A transactional email failed or the Brevo account refused the queue"
  "vokr_email_volume|textPayload:\"EMAIL_VOLUME\"|Daily email volume reached the 200 warning or the 290 stop"
  "vokr_credit_note_failed|textPayload:\"CREDIT_NOTE_FAILED\"|A GST credit note could not be issued"
  "vokr_admin_gate_error|textPayload:\"ADMIN_GATE_ERROR\"|The admin gate failed for a reason other than not-an-admin"
  "vokr_maintenance_not_ok|textPayload:\"[jobs/maintenance] finished ok=false\"|A maintenance run (every 5 min) did not finish cleanly"
)

for entry in "${METRICS[@]}"; do
  IFS='|' read -r name filter description <<<"$entry"
  if gcloud logging metrics describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud logging metrics update "$name" --project "$PROJECT" --description="$description" --log-filter="$BASE AND $filter" >/dev/null
    echo "updated metric $name"
  else
    gcloud logging metrics create "$name" --project "$PROJECT" --description="$description" --log-filter="$BASE AND $filter" >/dev/null
    echo "created metric $name"
  fi
done

if [ -z "$CHANNEL" ]; then
  echo "Metrics in place. Re-run with --channel <ID> to add alert policies."
  exit 0
fi

existing=$(gcloud alpha monitoring policies list --project "$PROJECT" --format="value(displayName)" 2>/dev/null || true)
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for entry in "${METRICS[@]}"; do
  IFS='|' read -r name _ description <<<"$entry"
  display="Vokr: $name"
  if grep -qxF "$display" <<<"$existing"; then echo "policy exists: $display"; continue; fi
  cat >"$tmp" <<JSON
{
  "displayName": "$display",
  "documentation": { "content": "$description. Runbooks: vokr/docs/infrastructure/alerting.md", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [{
    "displayName": "$name > 0 in 5 min",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/$name\" AND resource.type=\"cloud_run_revision\"",
      "aggregations": [{ "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "0s",
      "trigger": { "count": 1 }
    }
  }],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["$CHANNEL"]
}
JSON
  gcloud alpha monitoring policies create --project "$PROJECT" --policy-from-file="$tmp" >/dev/null
  echo "created policy: $display"
done
