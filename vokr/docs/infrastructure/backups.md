# Backups, retention and restore (plan §5 Phase 18, R17)

Code: `scripts/backup/backup.ts`, `scripts/backup/restore-drill.ts`,
`scripts/lib/backup-retention.ts`, `scripts/lib/pg-url.ts`, `scripts/lib/r2.ts`;
schedule `.github/workflows/backup.yml`; owner helper
`scripts/ops/add-backup-secret.ps1`. Tests: `scripts/__tests__/backup-retention.test.ts`,
`pg-url.test.ts`, `r2-endpoint.test.ts`, `backup-workflow.test.ts`,
`alert-policies.test.ts`.

## Status (19 Oct 2026)

| | Status |
|---|---|
| R2 bucket `vokr-backups` (private) + bucket-scoped Object Read & Write token | **Created by the owner** (reported; not inspected by the agent — no R2 credential in this environment) |
| `backup.ts`: dump → checksum → age → R2 → read-back → `COMPLETE` → retention plan | Built; **rehearsed end to end on 19 Oct 2026** against an S3-compatible stand-in (below) |
| `restore-drill.ts --from-r2` | Built; rehearsed: restore 8/8 PASS; refuses a partial folder, a wrong key and a corrupted object |
| `.github/workflows/backup.yml` (every 6 h) | In the repo, **off** (`BACKUP_ENABLED` unset); needs the owner steps below |
| Retention deletes | **Off** (`BACKUP_PRUNE_ENABLED` unset): every run only prints the plan |
| Alerts `vokr_backup_failed`, `vokr_backup_absent` | Defined as code; not created (needs the notification channel, as for every other alert) |
| Manual pre-migration exports (`C:\Users\Asus\vokr-backups\supabase-pre-*`) | Unchanged; still taken before every migration release |
| Supabase's own backups | Reported, not verified: the Free plan offers no downloadable daily backups — treat this job as the only automated copy |
| **R17** | **Not VERIFIED** until a drill restores a backup the *schedule* made from the real bucket |

## How it works

GitHub Actions cron (`17 */6 * * *`), the same pattern as `deploy.yml`:
**no Actions secrets**. The job authenticates to GCP with Workload
Identity Federation as a dedicated service account that can only be used
from the `backups` environment (branch `master`), reads three Secret Manager
secrets, and writes one log line per run. The repository is public, so its
logs are public: every secret is masked before use, and the scripts print
sizes and object keys only.

1. `pg_dump -Fc --quote-all-identifiers` of the **whole** database (`auth`
   too — without `auth.users` every account is lost) with `pg_dump 17` (the
   server is 17.6). The connection string comes from `BACKUP_DATABASE_URL`
   and is handed to `pg_dump` through its environment, never an argument.
   The run fails if the archive is unreadable or has no `auth.users` data.
2. `age -r $BACKUP_AGE_RECIPIENT` — **always encrypted before upload**; the
   job refuses to upload without a valid `age1…` public key. The private
   key stays offline with the owner. Without it no backup can be restored —
   guard it like the database.
3. Upload to `vokr-backups`:
   `db/<YYYYMMDDTHHMMSSZ>/full.dump.age`, `checksums.txt` (plaintext and
   ciphertext SHA-256), `manifest.json` (sizes, pg_dump and server version,
   TOC count). **Each object is read back and its SHA-256 compared**; only
   then is `db/<stamp>/COMPLETE` written (listing each object's hash) and
   read back. R2 does not document SHA-256/CRC-32 checksum headers on a
   single PutObject, so integrity comes from the read-back, and the client
   sends checksums only where the API requires them.
4. **A folder without `COMPLETE` is not a backup.** Retention, the restore
   drill's `latest`, the prune guard and the success heartbeat all ignore
   it, so an interrupted upload can never pass for a good backup.
5. Success: `BACKUP_OK {…}` to the `vokr-backup` log — written only from
   the result file `backup.ts` creates after `COMPLETE` is verified.
   Failure: `BACKUP_FAILED run=… url=…`.
6. No overlap: `concurrency: database-backup`, never cancelled in progress;
   30 min timeout. The plaintext dump is deleted as soon as the encrypted
   copy is verified, and the runner directory is removed on every exit.

## Retention (`planRetention`)

Keep, among **complete** backups: every backup from the last **48 h**
(8 × 6-hourly), the newest per UTC day for **14 days**, the newest per ISO
week for **8 weeks**, and **always the newest complete backup** whatever its
age (a stalled schedule never prunes the last good copy). Incomplete
folders are kept for 24 h (a run may still be uploading), then deleted as
debris. Unparseable keys are never deleted; future-dated folders are kept
and never count as "newest". Deleting requires `--apply-prune`, which the
workflow passes only when `BACKUP_PRUNE_ENABLED=true`, and refuses unless
this run's backup is complete and in the keep set. Deletes are single
`DeleteObject` calls (free operations on R2).

Steady state ≈ 8 + 13 + 7 ≈ **28 backups**. With pruning off, the bucket
grows by 4 backups a day.

**Cost (R2, from Cloudflare's pricing page, 1 Oct 2026):** Standard storage
10 GB-month free, then $0.015/GB-month; Class A (PutObject, ListObjects)
1 M/month free; Class B (GetObject) 10 M/month free; egress free;
DeleteObject free. One run is about 4 PutObject + 1 list + 4 GetObject
(read-back): ~600 Class A and ~500 Class B a month. The synthetic rehearsal
dump was 0.15 MB; the last production export was ~0.5 MB, so 28 backups are
~15 MB, and even without pruning a year is ~0.7 GB — **$0 at today's size**.
Revisit when a dump passes ~300 MB (≈ 8 GB retained).
**GCP side, not verified from the pricing pages** (they did not render for
the agent): three new Secret Manager secrets (one version each) and ~360
secret reads a month; a few log lines a day; two log-based metrics; two
alert policies. Secret Manager bills per active secret version beyond a
free tier, and Cloud Monitoring may bill alert conditions — **check both
pricing pages before creating them** (the project already holds 5
non-destroyed secret versions: `DATABASE_URL` ×3, `BREVO_API_KEY`,
`ORIGIN_AUTH_SECRET`; this adds 3).

## Alerting

| Policy | Fires when | First check |
|---|---|---|
| `vokr_backup_failed` (ERROR) | a run wrote `BACKUP_FAILED` | Open the run URL in the log line; the failing step names itself |
| `vokr_backup_absent` (ERROR) | **no `BACKUP_OK` for 8 h** (schedule 6 h + GitHub delay) | `BACKUP_ENABLED` off; workflow disabled by GitHub after 60 days without repository activity; WIF/secret access broken; or every run failing before it could log |

GitHub also emails the workflow's owner on a failed scheduled run. Both
metrics read the workflow's own log (`logs/vokr-backup`, resource `global`),
created by `scripts/ops/setup-log-alerts.sh`; the policies by
`apply-alert-policies.sh --apply --channel <ID>`. Test-fire:
`test-fire-alerts.sh --apply vokr_backup_failed`; for the absence alert,
leave `BACKUP_ENABLED` off for 8 h.

## Restore drill

```sh
# from the bucket (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUP_BUCKET=vokr-backups set; age on PATH)
npx tsx scripts/backup/restore-drill.ts --from-r2 latest --identity <path to vokr-backup.key> --report <dir>
npx tsx scripts/backup/restore-drill.ts --from-r2 20261019T061700Z --identity <key> --report <dir>   # a specific one
# from a local export
npx tsx scripts/backup/restore-drill.ts --dump <dir>/full.dump [--report <dir>]
```

`--from-r2` picks the newest **complete** backup (or the named one, which
must have `COMPLETE`), downloads it into a private temp directory, checks
the ciphertext SHA-256 against `checksums.txt` and the marker, decrypts
with `age -d`, checks the plaintext SHA-256, then runs the drill: list the
whole archive (auth included), restore `public` into a throwaway
`postgres:17-alpine` container bound to **127.0.0.1 only**, and check
migrations (a prefix of this checkout's), core tables, RLS on every public
table except `_prisma_migrations`, and that the container is gone. The
temp directory — decrypted dump included — is deleted pass or fail. The
drill **never connects to anything but its own container**; it has no
option to restore anywhere else. It restores `public` only; for `auth` it
checks that the data is present in the archive.

On the owner's Windows machine `age` is not installed: `winget install
FiloSottile.age` (or the official release zip from
github.com/FiloSottile/age/releases).

**Cadence:** monthly on the newest R2 backup and before every migration
release; record the report here.

### Rehearsal of record, 19 Oct 2026 (local, synthetic data — S3-compatible, not R2)

Reports and the backup log: `C:\Users\Asus\vokr-backups\restore-drills\rehearsal-r2-20261019\`
(`restore-drill-20261019T180646Z.*` is the passing drill).

Source: Supabase's own Postgres image `public.ecr.aws/supabase/postgres:17.6.1.167`
(server 17.6, as production; ships `auth`), all 10 migrations applied, the
catalog seed, one synthetic `auth.users` row. Storage: `versity/versitygw:v1.0.16`
(S3 gateway) standing in for R2 through the test-only `R2_ENDPOINT_OVERRIDE`
(accepts loopback/Docker hosts only; the workflow never sets it). Backup
ran in `ubuntu:24.04` with the workflow's install lines verbatim
(`pg_dump 17.11`, `age 1.1.1`, Node 22.12.0); throwaway age key pair.
Bucket pre-seeded with a 100-day-old complete backup, a 3-day-old partial
folder and a 1-hour-old partial folder.

- Refused `--apply-prune` without `--upload --apply`; refused to upload without a recipient.
- Run 1 (workflow arguments, pruning off): 152,858-byte dump, 27 TABLE DATA;
  4 objects uploaded **and verified by read-back**, then `COMPLETE`; result
  file written; plaintext dump removed. Plan: keep 2, delete 2
  (the 100-day backup and the 3-day partial) — **nothing deleted**.
- Run 2 (`--apply-prune`): same, then deleted exactly those 2 folders (5
  objects); the 1-hour partial kept (grace).
- `restore-drill --from-r2 latest`: ciphertext checksum PASS, plaintext
  checksum PASS, archive 358 TOC / 27 TABLE DATA / `auth.users` present,
  public restored 0 errors, migrations 10/10, core tables products 5 /
  variants 27 / inventory 27, RLS all on, container removed — **PASS**.
  Temp directory removed.
- Named partial folder → refused ("no COMPLETE marker"); wrong age key →
  refused (`no identity matched`); one byte flipped in the stored
  `full.dump.age` → refused ("Ciphertext SHA-256 … does not match"). Exit 1
  each time; temp directory removed each time.

Not covered by the rehearsal: real R2 (its acceptance of these requests),
Workload Identity, Secret Manager, `gcloud logging write`, GitHub's
scheduler, and production's size and contents.

### Drill of record (local export), 19 Oct 2026

`C:\Users\Asus\vokr-backups\restore-drills\restore-drill-20261019T043235Z.*`:

- PASS checksum (`34dccbfc3a8e1789…`, matches the export's `checksums.txt`)
- PASS archive readable: 732 TOC entries, 58 TABLE DATA, `auth.users` data present
- PASS public restored, 0 errors
- PASS migrations: 9 applied, last `20261016171356_email_log` (the snapshot predates `admin_ops`, so 1 pending vs this checkout — expected)
- PASS core tables: products 5, variants 27, inventory 27, app_users 0, payments 0, orders 0, order_items 0; `audit_log` not yet (later migration)
- PASS RLS on every public table
- PASS throwaway container removed — 7 s end to end

**Finding (for the security workstream, not changed here):** in the
2026-10-16 export, `anon` and `authenticated` still hold
`REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on every public table (DML and
SELECT were revoked). PostgREST cannot issue `TRUNCATE`, so this is not
reachable through the API today, but it is least-privilege debt: revoke
with `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`
(production SQL — owner authorization).

## Disaster recovery (production)

**Never restore over the live project.**

1. Decide the restore point; stop writes: the owner keeps
   `ORDERING_ENABLED=false` (already) — for a live store, scale Cloud Run to
   0 or set maintenance before restoring.
2. Run `restore-drill.ts --from-r2 <stamp>` on it. Never restore an
   unrehearsed backup. Then download and decrypt the same backup into a
   private directory (the drill's checks: ciphertext and plaintext SHA-256).
3. Restore to a **new** Supabase project, with the same flags as the
   rehearsal in `vokr-backups/*/MANIFEST.md`; run `prisma migrate deploy`
   for anything newer.
4. Point `DATABASE_URL` (and `BACKUP_DATABASE_URL`) at it, deploy, smoke
   test, then retire the old project. Steps 3–4 are production changes
   needing owner authorization.

RPO with the schedule on: ≤ 6 h. RTO: ~1 h (dominated by project creation
and secret rotation).

## Configuration — owner steps (in order)

Nothing below has been run by the agent. Each step is a production
change for the owner; none prints or stores a credential in the repository.

### Secrets and variables

| Secret Manager secret | Becomes (in the job) | Value |
|---|---|---|
| `BACKUP_DATABASE_URL` | `BACKUP_DATABASE_URL` → `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` | Supabase **session pooler** URL: `postgresql://postgres.<project-ref>:<db password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require` (the connection the manual exports use). Not the direct host (IPv6-only without the paid IPv4 add-on; GitHub runners are IPv4) and not port 6543 (transaction pooler — refused). |
| `R2_BACKUP_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` | the bucket-scoped token's Access Key ID |
| `R2_BACKUP_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` | the same token's Secret Access Key |

| Repository variable (not secret) | Value |
|---|---|
| `BACKUP_SERVICE_ACCOUNT` | `vokr-backup@vokr-website.iam.gserviceaccount.com` |
| `R2_ACCOUNT_ID` | the Cloudflare account ID (R2 → Overview) |
| `BACKUP_AGE_RECIPIENT` | the `age1…` public key from step 1 |
| `BACKUP_ENABLED` | `true` — **last**, after the first manual run passed |
| `BACKUP_PRUNE_ENABLED` | `true` — only after reviewing a few runs' retention plans |

`GCP_PROJECT_ID` and `WIF_PROVIDER` already exist (used by `deploy.yml`).
The bucket name `vokr-backups` is fixed in the workflow.

### 1. Encryption key (owner's machine, offline)

```powershell
winget install FiloSottile.age
age-keygen -o vokr-backup.key      # prints "Public key: age1…"
```

Keep `vokr-backup.key` offline (password manager + one printed copy).
Never upload it anywhere. The `age1…` public line becomes `BACKUP_AGE_RECIPIENT`.

### 2. Store the three secrets (PowerShell, from the clipboard; nothing is echoed)

```powershell
cd vokr
# copy the value, then:
powershell -File scripts/ops/add-backup-secret.ps1 -Name BACKUP_DATABASE_URL
powershell -File scripts/ops/add-backup-secret.ps1 -Name R2_BACKUP_ACCESS_KEY_ID
powershell -File scripts/ops/add-backup-secret.ps1 -Name R2_BACKUP_SECRET_ACCESS_KEY
```

The script checks the shape, creates the secret if missing (automatic
replication), adds the version from a temp file with no trailing newline,
deletes the file and clears the clipboard. gcloud must be the account with
rights on `vokr-website` (not the default `baquar@haett.app` project).

### 3. GitHub environment `backups`, master only — BEFORE step 4

The service account in step 4 trusts any job that runs in the `backups`
environment. If the environment does not exist yet, GitHub creates it
**unrestricted** the first time any branch's job names it — so create it,
with its branch policy, first, and check it:

```sh
gh api -X PUT repos/SmaranReddy/Vokr-Website/environments/backups \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/SmaranReddy/Vokr-Website/environments/backups/deployment-branch-policies -f name=master -f type=branch
# must show custom_branch_policies: true, and the policy list only `master`:
gh api repos/SmaranReddy/Vokr-Website/environments/backups --jq .deployment_branch_policy
gh api repos/SmaranReddy/Vokr-Website/environments/backups/deployment-branch-policies --jq '.branch_policies[].name'
```

### 4. Service account, per-secret IAM, Workload Identity (gcloud, `--project vokr-website`)

```sh
gcloud iam service-accounts create vokr-backup --project vokr-website \
  --display-name="Vokr database backup (GitHub Actions)"
SA=vokr-backup@vokr-website.iam.gserviceaccount.com
for s in BACKUP_DATABASE_URL R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY; do
  gcloud secrets add-iam-policy-binding "$s" --project vokr-website \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
gcloud projects add-iam-policy-binding vokr-website \
  --member="serviceAccount:$SA" --role=roles/logging.logWriter --condition=None
# Only the `backups` environment may impersonate it. This repository uses
# GitHub's immutable OIDC subject (owner and repository IDs), verified with
# `gh api repos/SmaranReddy/Vokr-Website/actions/oidc/customization/sub`.
gcloud iam service-accounts add-iam-policy-binding "$SA" --project vokr-website \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/978877857702/locations/global/workloadIdentityPools/github-actions/subject/repo:SmaranReddy@155671458/Vokr-Website@1360128345:environment:backups"
```

Per-secret bindings only: the backup account cannot read `DATABASE_URL`,
`BREVO_API_KEY` or anything else, and neither the Cloud Run account nor the
deployer gains access to the backup secrets (checked 19 Oct 2026: there is
no project-level Secret Manager grant).

### 5. Repository variables (`BACKUP_ENABLED` last)

```sh
gh variable set BACKUP_SERVICE_ACCOUNT --body vokr-backup@vokr-website.iam.gserviceaccount.com
gh variable set R2_ACCOUNT_ID --body <account id>
gh variable set BACKUP_AGE_RECIPIENT --body <age1… public key>
```

### 6. First run, then the drill

`BACKUP_ENABLED` gates the job for both triggers, so set it, then run once by hand:
`gh variable set BACKUP_ENABLED --body true`, then
`gh workflow run backup.yml --ref master`. Check the run: four "uploaded +
verified" lines, a retention plan, `BACKUP_OK`. Then, on the owner's
machine with the private key and the R2 token in the environment, run
`restore-drill.ts --from-r2 latest` and record the report above → **R17
VERIFIED**. If the first run fails at authentication, the subject in step 4
is the first thing to compare with the run's OIDC token claims.

### 7. Alerts and pruning

`bash scripts/ops/setup-log-alerts.sh --channel <ID>` (creates the two
backup metrics and, with the channel, their policies). After a few runs'
retention plans look right: `gh variable set BACKUP_PRUNE_ENABLED --body true`.

## Missing permissions and infrastructure (as of 19 Oct 2026)

- **Service account `vokr-backup`** and its bindings — does not exist (step 4).
- **Secrets** `BACKUP_DATABASE_URL`, `R2_BACKUP_ACCESS_KEY_ID`,
  `R2_BACKUP_SECRET_ACCESS_KEY` — do not exist (step 2).
- **GitHub environment `backups`** — does not exist (step 3, before step 4); variables
  `BACKUP_SERVICE_ACCOUNT`, `R2_ACCOUNT_ID`, `BACKUP_AGE_RECIPIENT`,
  `BACKUP_ENABLED`, `BACKUP_PRUNE_ENABLED` unset.
- **age key pair** — owner (step 1).
- **Notification channel** — owner's choice, as for every alert.
- **Least privilege, later:** `BACKUP_DATABASE_URL` is the `postgres` login
  (as the manual exports). A dedicated read-only dump role would need
  grants on Supabase-managed schemas (`auth`, `storage`) — a separate,
  reviewed change.
- **Existing, unchanged (flagged):** `github-deployer` can be impersonated
  by any workflow in this public repository (`principalSet …/attribute.repository/…`,
  any branch) and can read `DATABASE_URL`. The backup account is bound more
  narrowly; consider the same environment-scoped binding for the deployer.
