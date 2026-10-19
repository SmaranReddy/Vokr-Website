#!/usr/bin/env bash
# Alert policies and the /api/health uptime check for Vokr (plan §5 Phase 15).
#
#   bash scripts/ops/apply-alert-policies.sh                          # DRY RUN (default): validate, print what would be created
#   bash scripts/ops/apply-alert-policies.sh --apply --channel <ID>   # create what does not exist yet
#
# Definitions: scripts/ops/alert-policies/*.json — one file per policy, with
# ${NOTIFICATION_CHANNEL} (and, for the uptime policy, ${UPTIME_CHECK_ID})
# filled in here. The log-based metrics they count are created by
# setup-log-alerts.sh, which must run first. Idempotent: an existing policy
# (same displayName) or uptime check (same displayName) is skipped, never
# changed — edit it in the console or delete it and re-run.
#
# <ID> is a notification channel ("projects/vokr-website/notificationChannels/123"
# or just "123"), e.g. from
#   gcloud beta monitoring channels create --project vokr-website \
#     --type=email --display-name="Vokr ops" --channel-labels=email_address=<inbox someone reads>
set -euo pipefail
PROJECT=vokr-website
DIR="$(cd "$(dirname "$0")/alert-policies" && pwd)"
APPLY=0
CHANNEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --channel) CHANNEL="${2:?channel id required}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
if [ "$APPLY" = 1 ] && [ -z "$CHANNEL" ]; then echo "--apply needs --channel <ID>" >&2; exit 2; fi
case "$CHANNEL" in ""|projects/*) ;; *) CHANNEL="projects/$PROJECT/notificationChannels/$CHANNEL" ;; esac

render() { # file -> stdout, placeholders filled
  sed -e "s#\${NOTIFICATION_CHANNEL}#${CHANNEL:-DRY-RUN-CHANNEL}#g" -e "s#\${UPTIME_CHECK_ID}#${UPTIME_ID:-DRY-RUN-UPTIME-ID}#g" "$1"
}
valid_json() { node -e 'JSON.parse(require("fs").readFileSync(0, "utf8"))'; }

# 1. Uptime check (its id is needed by the uptime policy).
UPTIME_FILE="$DIR/uptime-check-health.json"
valid_json <"$UPTIME_FILE"
UPTIME_NAME=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).displayName)' "$UPTIME_FILE")
UPTIME_ID=""
if [ "$APPLY" = 1 ]; then
  UPTIME_ID=$(gcloud monitoring uptime list-configs --project "$PROJECT" --filter="displayName=$UPTIME_NAME" --format="value(name.basename())" | head -1)
  if [ -n "$UPTIME_ID" ]; then
    echo "uptime check exists: $UPTIME_NAME ($UPTIME_ID)"
  else
    UPTIME_ID=$(curl -sf -X POST "https://monitoring.googleapis.com/v3/projects/$PROJECT/uptimeCheckConfigs" \
      -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "content-type: application/json" \
      --data-binary @"$UPTIME_FILE" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).name.split("/").pop())')
    echo "created uptime check: $UPTIME_NAME ($UPTIME_ID)"
  fi
else
  echo "[dry-run] would create uptime check \"$UPTIME_NAME\" from $(basename "$UPTIME_FILE") if absent"
fi

# 2. Alert policies.
existing=""
if [ "$APPLY" = 1 ]; then
  existing=$(gcloud alpha monitoring policies list --project "$PROJECT" --format="value(displayName)")
fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for file in "$DIR"/vokr_*.json; do
  render "$file" >"$tmp"
  valid_json <"$tmp"
  display=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).displayName)' "$tmp")
  if [ "$APPLY" = 0 ]; then
    echo "[dry-run] would create policy \"$display\" from $(basename "$file") if absent"
    continue
  fi
  if grep -qxF "$display" <<<"$existing"; then echo "policy exists: $display"; continue; fi
  gcloud alpha monitoring policies create --project "$PROJECT" --policy-from-file="$tmp" >/dev/null
  echo "created policy: $display"
done
[ "$APPLY" = 1 ] || echo "Dry run only. Nothing was created. Re-run with --apply --channel <ID>."
