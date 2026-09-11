#!/usr/bin/env bash
# Production migration gate — Phase 19 task 11 (../Vokr-Implementation-Plan.md).
#
# Runs in deploy.yml's approval-gated `deploy` job, BEFORE the new revision
# is created. It exists because of a real defect: Phase 5's code reached
# production while its migration had never been applied, and `/api/cart`
# returned 500 until the schema was fixed by hand (Phase 19 Status). This
# gate refuses to deploy code against a database that lacks a migration the
# code ships with.
#
#   MODE=check  (default, every push to master) — read-only.
#               Schema up to date -> pass. Anything else -> fail, nothing deployed.
#   MODE=apply  (workflow_dispatch with apply_migrations=true only) —
#               pending migrations that are purely ADDITIVE are applied with
#               `prisma migrate deploy`, then status must read "up to date".
#
# Fails closed on everything it does not positively recognise: failed or
# modified migrations, drift, migrations present in the database but not in
# this commit, unparseable output, or any pending migration containing a
# non-additive statement (expand/contract, task 11 — a contract step is
# applied by hand after a backup, never by the pipeline).
#
# The connection is derived in-process from Secret Manager `DATABASE_URL`
# (transaction pooler, 6543) as the session pooler (5432) that migrations
# require — README "Database — real Supabase project" and plan §0.2 row 3.
# It is masked in the Actions log and never written to disk. No seed, no
# `supabase config push`.
set -euo pipefail

MODE="${MODE:-check}"
PROJECT="${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }
mask() { if [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ]; then echo "::add-mask::$1"; fi; }

case "$MODE" in check | apply) ;; *) fail "MODE must be 'check' or 'apply', got '$MODE'." ;; esac
echo "Migration gate: mode=$MODE"

# --- 1. Derive the session-pooler connection -------------------------------
RAW="$(gcloud secrets versions access latest --secret=DATABASE_URL --project="$PROJECT" 2>/dev/null)" ||
  fail "cannot read DATABASE_URL from Secret Manager. The deploy identity needs roles/secretmanager.secretAccessor on that one secret — see docs/infrastructure/cicd.md."
RAW="$(printf '%s' "$RAW" | tr -d '\r\n')"
RAW="${RAW#$'\xEF\xBB\xBF'}"
mask "$RAW"
PASS="$(printf '%s' "$RAW" | sed -nE 's#^[a-z]+://[^:/@]*:([^@]*)@.*#\1#p')"
mask "$PASS"

case "$RAW" in postgres://* | postgresql://*) ;; *) fail "the secret is not a postgres URL." ;; esac
case "$RAW" in *:6543/*) ;; *) fail "the secret is not on port 6543 — refusing to guess its session-pooler form." ;; esac

BASE="${RAW%%\?*}"
QUERY=""
if [ "$BASE" != "$RAW" ]; then QUERY="${RAW#*\?}"; fi
KEPT="$(printf '%s' "$QUERY" | tr '&' '\n' | grep -vE '^(pgbouncer=|$)' | paste -sd '&' - || true)"
DB_URL="${BASE/:6543\//:5432/}"
if [ -n "$KEPT" ]; then DB_URL="$DB_URL?$KEPT"; fi
unset RAW BASE QUERY KEPT
mask "$DB_URL"

HOST="$(printf '%s' "$DB_URL" | sed -nE 's#^[a-z]+://[^@]*@([^:/]+):.*#\1#p')"
case "$DB_URL" in *:5432/*) ;; *) fail "derived connection is not on port 5432." ;; esac
case "$DB_URL" in *6543* | *pgbouncer*) fail "derived connection still carries the transaction-pooler form." ;; esac
case "$HOST" in *.pooler.supabase.com) ;; *) fail "derived host is not a Supabase pooler." ;; esac
[ -n "$PASS" ] || fail "derived connection has no password."
unset PASS
echo "Connection: session pooler, host=$HOST port=5432 (credential masked)"

# The CLI entry point, run by node directly: `npx prisma` goes through a
# .cmd shim on Windows, and this gate must behave identically wherever it
# is exercised, not only on the Linux runner.
PRISMA_CLI="node_modules/prisma/build/index.js"
[ -f "$PRISMA_CLI" ] || fail "Prisma CLI not found at $PRISMA_CLI — run npm ci first."

run_status() {
  DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" node "$PRISMA_CLI" migrate status 2>&1
}

# --- 2. Read the migration state -------------------------------------------
set +e
OUT="$(run_status)"
RC=$?
set -e
printf '%s\n' "$OUT"

printf '%s' "$OUT" | grep -q "pooler.supabase.com:5432" ||
  fail "Prisma did not report the 5432 session pooler as its datasource."

if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "Database schema is up to date"; then
  echo "OK: production schema matches this commit's migrations. Nothing to apply."
  exit 0
fi

for bad in "have failed" "not found locally" "not managed by Prisma Migrate" \
  "Drift detected" "was modified after it was applied"; do
  if printf '%s' "$OUT" | grep -qi "$bad"; then
    fail "the database is not simply behind this commit ('$bad'). Resolve by hand; the pipeline will not."
  fi
done
printf '%s' "$OUT" | grep -q "have not yet been applied" ||
  fail "unrecognised 'prisma migrate status' output (exit $RC) — refusing to guess."

PENDING="$(printf '%s\n' "$OUT" | grep -E '^[0-9]{14}_[A-Za-z0-9_]+$' | sort -u)"
[ -n "$PENDING" ] || fail "status reports pending migrations, but none could be parsed."

# --- 3. Pending migrations must be additive (expand/contract) --------------
NON_ADDITIVE='\bDROP[[:space:]]+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|FUNCTION|TRIGGER|INDEX|CONSTRAINT|POLICY|EXTENSION|SEQUENCE)\b|\bTRUNCATE\b|(^|;)[[:space:]]*DELETE[[:space:]]+FROM\b|(^|;)[[:space:]]*UPDATE[[:space:]]|\bRENAME\b|\bALTER[[:space:]]+COLUMN[^;]*[[:space:]]TYPE\b|\bSET[[:space:]]+NOT[[:space:]]+NULL\b'
BLOCKED=""
for m in $PENDING; do
  SQL_FILE="prisma/migrations/$m/migration.sql"
  [ -f "$SQL_FILE" ] || fail "pending migration $m has no migration.sql in this commit."
  HITS="$(sed -e 's/--.*$//' "$SQL_FILE" | tr '\n' ' ' | grep -oiE "$NON_ADDITIVE" | sort -u | paste -sd ',' - || true)"
  if [ -n "$HITS" ]; then
    BLOCKED="$BLOCKED $m[$HITS]"
    echo "  pending: $m  -> NON-ADDITIVE: $HITS"
  else
    echo "  pending: $m  -> additive"
  fi
done
if [ -n "$BLOCKED" ]; then
  fail "non-additive statement(s) in:$BLOCKED. Contract-phase changes are applied by hand after a backup, never by the pipeline."
fi

if [ "$MODE" = "check" ]; then
  fail "$(printf '%s' "$PENDING" | wc -l | tr -d ' ') pending migration(s) — deploying this code would run it against a schema it does not have. Take a pg_dump first (Phase 18 backups do not exist yet), then re-run this workflow via workflow_dispatch with apply_migrations=true."
fi

# --- 4. Apply (explicitly requested, approval-gated, additive only) --------
echo "Applying $(printf '%s' "$PENDING" | wc -l | tr -d ' ') additive migration(s) with prisma migrate deploy…"
DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL" node "$PRISMA_CLI" migrate deploy

set +e
OUT="$(run_status)"
RC=$?
set -e
printf '%s\n' "$OUT"
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "Database schema is up to date"; then
  echo "OK: migrations applied; production schema now matches this commit."
  exit 0
fi
fail "after 'migrate deploy' the schema is still not up to date (exit $RC)."
