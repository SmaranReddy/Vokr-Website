# Backups, retention and restore (plan §5 Phase 18, R17)

Code: `scripts/backup/backup.ts`, `scripts/backup/restore-drill.ts`,
`scripts/lib/backup-retention.ts` (tested in `scripts/__tests__/backup-retention.test.ts`),
`scripts/lib/r2.ts`. Proposed schedule: `docs/infrastructure/backup-workflow.example.yml`
(**not enabled** — see "Turning it on").

## What exists today

| | Status |
|---|---|
| Manual pre-migration exports (`C:\Users\Asus\vokr-backups\supabase-pre-*`) | Taken before every migration release; SHA-256 + restore rehearsal in each `MANIFEST.md` |
| `backup.ts` (dump → checksum → age-encrypt → R2 → prune) | Built; run locally against Compose Postgres (dump + dry-run upload/prune) |
| `restore-drill.ts` | Built; **run for real 19 Oct 2026** against `supabase-pre-pr35-20261016-185516Z\full.dump`: 7/7 PASS (below) |
| Automated 6-hourly schedule | **Not running** — needs R2 bucket + credentials, an age key pair, and the owner's go-ahead |
| Supabase's own backups | Reported, not verified: the Free plan offers no downloadable daily backups (Pro and PITR are paid) — confirm in the dashboard; treat this job as the only automated copy |

## Backup job

```sh
# libpq env only (PGHOST, PGPORT, PGUSER, PGDATABASE, PGSSLMODE=require, PGPASSWORD or PGPASSFILE)
npx tsx scripts/backup/backup.ts --out ./backups --upload --prune          # dry run: dumps locally, prints the plan
npx tsx scripts/backup/backup.ts --out ./backups --upload --prune --apply  # uploads + prunes
```

- `pg_dump -Fc --quote-all-identifiers` of the **whole** database (the
  `auth` schema too — without `auth.users` every account is lost), the same
  flags as the manual exports. The new archive is read back with
  `pg_restore --list` before anything is uploaded.
- **Encrypted before upload, always:** `age -r $BACKUP_AGE_RECIPIENT`. The job
  refuses to upload without a valid `age1…` recipient. Only the public key
  lives in CI; the private key is kept offline by the owner (password
  manager + one printed copy). Without the private key no backup can be
  restored — guard it like the database itself.
- Layout in the private bucket `R2_BACKUP_BUCKET`:
  `db/<YYYYMMDDTHHMMSSZ>/full.dump.age`, `checksums.txt` (plaintext and
  ciphertext SHA-256), `manifest.json` (sizes, pg_dump version, TOC count).
- Logs print sizes and object keys only — never the connection, never
  data. (The repository is public, so CI logs are world-readable.)

## Retention (`planRetention`)

Keep: every backup from the last **48 h** (8 × 6-hourly), the newest per UTC
day for **14 days**, the newest per ISO week for **8 weeks**, and **always the
newest backup** whatever its age (a stalled schedule never prunes the last
good copy). Unparseable keys and future-dated keys are never deleted. The
prune refuses to run if the backup it just made is not in the keep set.
Steady state ≈ 8 + 13 + 7 ≈ **28 backups**; at today's ~0.5 MB per
compressed dump that is ~15 MB — far inside R2's free 10 GB. Revisit when
a dump passes ~300 MB (≈ 8 GB retained).

## Restore drill

```sh
npx tsx scripts/backup/restore-drill.ts --dump <dir>/full.dump [--report <dir>]
```

Verifies SHA-256 against `checksums.txt`, lists the whole archive, restores
`public` into a throwaway `postgres:17-alpine` container on 127.0.0.1, then
checks migrations (a prefix of this checkout's), core tables (each required
once its creating migration is applied), RLS on every public table except
Prisma's `_prisma_migrations` (no RLS by design; the API roles hold no
SELECT on it), and that the container is gone. Writes a JSON + Markdown
report. For an R2 backup: download, `age -d -i <private key>` to
`full.dump`, then run the drill.

**Drill of record, 19 Oct 2026** (`C:\Users\Asus\vokr-backups\restore-drills\restore-drill-20261019T043235Z.*`):

- PASS checksum (`34dccbfc3a8e1789…`, matches the export's `checksums.txt`)
- PASS archive readable: 732 TOC entries, 58 TABLE DATA, `auth.users` data present
- PASS public restored, 0 errors
- PASS migrations: 9 applied, last `20261016171356_email_log` (the snapshot predates `admin_ops`, so 1 pending vs this checkout — expected)
- PASS core tables: products 5, variants 27, inventory 27, app_users 0, payments 0, orders 0, order_items 0; `audit_log` not yet (later migration)
- PASS RLS on every public table
- PASS throwaway container removed — 7 s end to end

**Cadence:** run the drill on the newest R2 backup monthly and before every
migration release; record the report here. R17 is VERIFIED only once a
drill has restored a backup the *schedule* made.

**Finding (for the security workstream, not changed here):** in the
2026-10-16 export, `anon` and `authenticated` still hold
`REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` on every public table (DML and
SELECT were revoked). PostgREST cannot issue `TRUNCATE`, so this is not
reachable through the API today, but it is least-privilege debt: revoke
with `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`
(production SQL — owner authorization).

## Disaster recovery (production)

1. Decide the restore point; stop writes: the owner keeps
   `ORDERING_ENABLED=false` (already) — for a live store, scale Cloud Run to
   0 or set maintenance before restoring.
2. Fetch the backup (R2, or the newest local export), verify `checksums.txt`,
   decrypt.
3. **Rehearse first:** `restore-drill.ts` on it. Never restore an unrehearsed dump.
4. Restore to a **new** Supabase project (never over the live one), with
   the same flags as the rehearsal in `vokr-backups/*/MANIFEST.md`; run
   `prisma migrate deploy` for anything newer.
5. Point `DATABASE_URL`/`DIRECT_URL` (Secret Manager) at it, deploy, smoke
   test, then retire the old project. Each of 4–5 is a production change
   needing owner authorization.

RPO with the schedule on: ≤ 6 h. RTO: ~1 h (dominated by project creation
and secret rotation).

## Turning it on — scheduler choice

| | GitHub Actions cron (**recommended**) | Cloud Run job + Cloud Scheduler |
|---|---|---|
| Cost | ₹0 (public repo: unlimited minutes) | ₹0 within free tiers (3rd of 3 free Scheduler jobs; job CPU in the free allowance) |
| New infrastructure | None — the workflow file | A job image with `pg_dump` + `age` + Node in Artifact Registry (the 0.5 GB quota is the tightest in the stack) |
| Secrets | GitHub `backups` environment: DB connection, R2 token | Already in Secret Manager |
| Risks | Public logs (mitigated: nothing sensitive is printed); scheduled runs can be delayed and are auto-disabled after 60 days without repository activity — the alert below catches a stall | More moving parts |

**Owner actions to enable (in order):**
1. Create the private R2 bucket `vokr-backups` (no public access, no custom domain).
2. Create an R2 API token **scoped to that bucket only**, Object Read & Write.
3. `age-keygen -o vokr-backup.key` on the owner's machine; keep the file offline; give the `age1…` public line to CI.
4. GitHub → Settings → Environments → `backups` (required reviewer: none; branch: `master`): secrets `BACKUP_PGHOST`, `BACKUP_PGUSER`, `BACKUP_PGPASSWORD` (the pooler session-mode connection the manual exports use), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; variable `BACKUP_AGE_RECIPIENT`.
5. Copy `docs/infrastructure/backup-workflow.example.yml` to `.github/workflows/backup.yml` (a reviewed PR), run it once with `workflow_dispatch`, download that backup, run the drill on it, record it above → R17 VERIFIED.
6. Alerting: a "no successful backup in 8 h" check (Phase 15) — the maintenance job can read the newest key's timestamp once R2 credentials exist in Cloud Run, or GitHub's failed-run email covers the job failing (not a stalled schedule).
