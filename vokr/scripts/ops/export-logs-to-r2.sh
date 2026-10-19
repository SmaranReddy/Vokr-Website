#!/usr/bin/env bash
# Weekly Cloud Logging export to R2 (plan §9 / §3.5: processing and traffic
# logs kept >= 1 year; Cloud Logging's default bucket keeps 30 days). R22.
#
#   bash scripts/ops/export-logs-to-r2.sh                  # DRY RUN (default): prints the plan, reads and writes nothing
#   bash scripts/ops/export-logs-to-r2.sh --execute        # reads the last 7 days, gzips, uploads to R2
#   bash scripts/ops/export-logs-to-r2.sh --execute --days 14
#
# --execute needs (environment, never arguments — they would land in shell history):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_LOG_BUCKET
# and the `aws` CLI (S3-compatible client; R2 speaks the S3 API). Nothing
# here prints a credential.
#
# What is exported: Cloud Run request and application logs of the `vokr`
# service. By design they carry no emails, addresses or bodies — request
# ids, user/order ids and client IPs (see docs/privacy/data-inventory.md),
# so the export file is personal data: the bucket must be private, and an
# R2 lifecycle rule (set once in the dashboard) deletes objects after the
# retention period legal review settles (see legal-review-proposal.md Q5).
#
# Not scheduled. An alternative that needs no R2 credentials at all: a
# Cloud Logging log bucket with 365-day retention plus a sink for the
# service (`gcloud logging buckets create ... --retention-days=365`) —
# billed per GiB stored beyond 30 days. That is an owner decision (cost).
set -euo pipefail

PROJECT=vokr-website
SERVICE=vokr
DAYS=7
EXECUTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --days) DAYS="${2:?--days needs a number}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$DAYS" in ''|*[!0-9]*) echo "--days must be a whole number" >&2; exit 2 ;; esac

END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START=$(date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ)
FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND timestamp>=\"$START\" AND timestamp<\"$END\""
OBJECT="cloud-run/${SERVICE}/$(date -u +%Y)/${START%%T*}_to_${END%%T*}.jsonl.gz"

echo "project:  $PROJECT"
echo "window:   $START .. $END ($DAYS days)"
echo "filter:   $FILTER"
echo "object:   r2://\${R2_LOG_BUCKET}/$OBJECT"

if [ "$EXECUTE" -ne 1 ]; then
  echo "DRY RUN: nothing read, nothing written. Re-run with --execute."
  exit 0
fi

for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_LOG_BUCKET; do
  if [ -z "${!name:-}" ]; then echo "missing environment variable: $name" >&2; exit 1; fi
done
command -v aws >/dev/null || { echo "the aws CLI is required (S3-compatible client)" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
gcloud logging read "$FILTER" --project "$PROJECT" --format=json --order=asc \
  | python -c 'import json,sys; [print(json.dumps(e, separators=(",",":"))) for e in json.load(sys.stdin)]' \
  | gzip -9 > "$WORK/export.jsonl.gz"
LINES=$(gzip -dc "$WORK/export.jsonl.gz" | wc -l | tr -d ' ')
SHA=$(sha256sum "$WORK/export.jsonl.gz" | cut -d' ' -f1)
echo "entries:  $LINES  sha256: $SHA"

AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
  aws s3 cp "$WORK/export.jsonl.gz" "s3://${R2_LOG_BUCKET}/${OBJECT}" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --metadata "sha256=$SHA,entries=$LINES" --only-show-errors
echo "uploaded: r2://${R2_LOG_BUCKET}/${OBJECT}"
