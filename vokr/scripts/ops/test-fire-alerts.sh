#!/usr/bin/env bash
# Make every log-based alert fire once, safely (plan §5 Phase 15: "observe
# every alert fire once"). Writes ONE synthetic log line per metric into
# Cloud Logging under the `vokr` Cloud Run service's resource labels, so the
# metric counts it, the policy fires and the notification arrives — without
# touching the application, its database, Razorpay or Brevo.
#
#   bash scripts/ops/test-fire-alerts.sh                    # DRY RUN (default): print the entries
#   bash scripts/ops/test-fire-alerts.sh --apply            # write them (owner: production logging write)
#   bash scripts/ops/test-fire-alerts.sh --apply vokr_email_failed   # just one
#
# Every line starts with "ALERT-TEST" so it is recognisable in the
# notification and in Logs Explorer. Expect each alert within ~5 minutes;
# they auto-close after 24 h (or close them by hand).
#
# Not covered here (see docs/infrastructure/alerting.md → Test-fire):
# vokr_maintenance_absent (pause the Scheduler job), vokr_backup_absent
# (leave BACKUP_ENABLED off for 8 h) and the uptime alert
# (point the check at a 404 path), which need a real outage signal.
set -euo pipefail
PROJECT=vokr-website
SERVICE=vokr
REGION=asia-south1
APPLY=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    vokr_*) ONLY="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# metric | a line that matches its filter in setup-log-alerts.sh
LINES=(
  "vokr_order_orphan|ALERT-TEST [jobs/maintenance] ORDER_ORPHAN synthetic"
  "vokr_late_payment_manual_review|ALERT-TEST [payments] LATE_PAYMENT manual_review synthetic"
  "vokr_unmatched_payment|ALERT-TEST [webhooks/razorpay] UNMATCHED_PAYMENT synthetic"
  "vokr_amount_mismatch|ALERT-TEST [payments] reason=amount_mismatch synthetic"
  "vokr_reconcile_failed|ALERT-TEST [payments] RECONCILE_FAILED synthetic (x2: this alert needs more than one in 15 min)"
  "vokr_reconcile_failed|ALERT-TEST [payments] RECONCILE_FAILED synthetic (second)"
  "vokr_email_failed|ALERT-TEST [email] EMAIL_FAILED synthetic"
  "vokr_form_delivery_failed|ALERT-TEST [marketing/contact] FORM_DELIVERY_FAILED {\"form\":\"contact\",\"reason\":\"test\"}"
  "vokr_email_volume|ALERT-TEST [email] EMAIL_VOLUME synthetic"
  "vokr_credit_note_failed|ALERT-TEST [invoices] CREDIT_NOTE_FAILED synthetic"
  "vokr_admin_gate_error|ALERT-TEST [admin] ADMIN_GATE_ERROR synthetic"
  "vokr_maintenance_not_ok|ALERT-TEST [jobs/maintenance] finished ok=false {}"
)
# Written to the backup workflow's own log (global resource), not Cloud Run's.
JOB_LINES=(
  "vokr_backup_failed|ALERT-TEST BACKUP_FAILED synthetic"
)

entries=()
for line in "${LINES[@]}"; do
  IFS='|' read -r metric text <<<"$line"
  [ -z "$ONLY" ] || [ "$ONLY" = "$metric" ] || continue
  entries+=("$(node -e '
    const [project, service, region, text] = process.argv.slice(1);
    console.log(JSON.stringify({
      logName: `projects/${project}/logs/run.googleapis.com%2Fstderr`,
      resource: { type: "cloud_run_revision", labels: { project_id: project, service_name: service, location: region, revision_name: "alert-test", configuration_name: service } },
      severity: "ERROR",
      textPayload: text,
    }));' "$PROJECT" "$SERVICE" "$REGION" "$text")")
done
for line in "${JOB_LINES[@]}"; do
  IFS='|' read -r metric text <<<"$line"
  [ -z "$ONLY" ] || [ "$ONLY" = "$metric" ] || continue
  entries+=("$(node -e '
    const [project, text] = process.argv.slice(1);
    console.log(JSON.stringify({ logName: `projects/${project}/logs/vokr-backup`, resource: { type: "global", labels: { project_id: project } }, severity: "ERROR", textPayload: text }));' "$PROJECT" "$text")")
done
[ "${#entries[@]}" -gt 0 ] || { echo "no metric matched \"$ONLY\"" >&2; exit 2; }

body="{\"entries\":[$(IFS=,; echo "${entries[*]}")]}"
if [ "$APPLY" = 0 ]; then
  echo "[dry-run] would write ${#entries[@]} synthetic log entries:"
  node -e 'for (const e of JSON.parse(process.argv[1]).entries) console.log("  " + e.textPayload)' "$body"
  echo "Dry run only. Nothing was written. Re-run with --apply."
  exit 0
fi
curl -sf -X POST "https://logging.googleapis.com/v2/entries:write" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "content-type: application/json" \
  --data-binary "$body" >/dev/null
echo "wrote ${#entries[@]} synthetic entries; expect the alerts within ~5 min."
