# Migration rehearsal: PR #38 (invoices), alone and with #49 + #51

**Status: rehearsal prep only. Not release evidence.** It was run on 19 Oct
2026 against a **3-day-old** backup. The release still needs the full sequence
in `CLAUDE.md` ("Production migrations"), starting with a **fresh** `pg_dump`
with verified hashes taken just before the merge. Nothing here touched
Supabase, Cloud Run or any production system.

## Source

- **Backup:** `C:\Users\Asus\vokr-backups\supabase-pre-pr35-20261016-185516Z\`.
  This is the latest backup on disk, taken 16 Oct 2026 18:55Z.
  - `sha256sum -c checksums.txt` reports OK for `full.dump`, `public.dump`,
    `data.sql`, `roles.sql` and `schema.sql`.
  - The snapshot is **pre-PR #35**: 9 migrations, ending
    `20261016171356_email_log`. So `20261016175750_admin_ops`, which is already
    applied in production, is pending here too. Production today has 10.
- **Target:** a throwaway `postgres:17-alpine` container on `127.0.0.1:55441`,
  deleted afterwards.
  - `public.dump` was restored with
    `pg_restore --no-owner --no-privileges` into two databases. The only
    error was the expected `schema "public" already exists`.
  - Restored state: 9 migrations; products, variants and orders 5 / 27 / 0.
- **Migrations, in ship order:**

  | Migration | Source | sha256 (prefix) |
  |---|---|---|
  | `20261016175750_admin_ops` | master (already in production) | — |
  | `20261017060130_invoices` | #38 `feat/gst-invoices` | `460865add54ecc10` |
  | `20261017143950_returns_rto` | #49 `feat/phase-10-returns-rto` | `e0ac638d68a3cd8a` |
  | `20261019041009_privacy_dpdp` | #51 `feat/phase-17-privacy` | `a56675c9d53f3928` |

## Pass 1: #38 alone (database `r38`)

- `prisma migrate status`: 11 found; pending `admin_ops` and `invoices`.
- `migrate deploy` applied both, exit 0. Status afterwards: up to date.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
  reported **"No difference detected"** (exit 0).
- **Afterwards:**
  - 11 finished migrations.
  - `invoices`, `credit_notes` and `invoice_counters` exist with RLS **on**.
  - Append-only triggers `invoices_no_update` and `credit_notes_no_update`
    exist.
  - Products, variants and orders unchanged at 5 / 27 / 0.

## Pass 2: #38 + #49 + #51 in ship order (database `r38all`)

- A combined migration set was assembled outside the repo: #38's migrations
  plus the two other branches' `migration.sql`, byte-for-byte via `git show`.
  A temporary, untracked Prisma config was used and deleted afterwards.
- `migrate deploy` on the restored copy applied `admin_ops` → `invoices` →
  `returns_rto` → `privacy_dpdp`, exit 0. Status afterwards: up to date,
  13 migrations.
- **No merged `schema.prisma` exists yet**, so `migrate diff` against a schema
  is not possible for this pass. Instead, the same 13 migrations were applied
  to an **empty** database (`rfresh`). Then `pg_dump --schema-only -n public`
  of both databases was diffed.
  - **Result: identical** (1,320 lines). The only difference was pg_dump's
    random per-dump `\restrict` token.
  - So the restored production copy ends in exactly the schema a clean build
    produces.
- **Afterwards:**
  - 13 finished migrations.
  - RLS on for `invoices`, `credit_notes`, `invoice_counters`,
    `return_requests`, `consent_records` and `data_subject_requests`.
  - Products, variants, orders and app_users unchanged at 5 / 27 / 0 / 0.
- **Overlap:** the three migrations touch disjoint objects. `invoices` adds its
  own three tables, sequence-free counters and triggers. `returns_rto` adds
  `return_requests` and its enums, with FKs to `orders`, `order_items` and
  `product_variants`. `privacy_dpdp` adds `consent_records` and
  `data_subject_requests`, with FKs to `app_users`. None alters a table
  another one creates.

## Merge-order notes

- `20261017060130_invoices` sorts **before** `20261017143950_returns_rto` and
  `20261019041009_privacy_dpdp`.
  - If #49 or #51 ships first, `migrate deploy` later applies the
    earlier-dated invoices migration out of timestamp order. Prisma applies
    any unapplied migration, which is safe here because the objects are
    disjoint.
  - **Ship in timestamp order anyway** (#38 → #49 → #51), so each release's
    pending set is exactly what was rehearsed.
- `schema.prisma` will conflict trivially between branches: each adds
  relations to `Order` and/or `AppUser`. After resolving, run
  `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma`
  (with a shadow DB) to prove the merged schema matches.

## Still required at release (not done here)

1. A fresh production backup (`meta/dump.sh` method) with SHA-256 hashes.
2. Restore it to an isolated cluster, and rehearse exactly the pending set for
   that release.
3. Prove the pending set out of band. Then merge, cancel the push run, and
   dispatch `deploy.yml` with `apply_migrations=true`.
4. Owner approves the gate.

**#38 additionally stays DO NOT MERGE until the CA review and the decisions in
the PR body are made.**

## Rollback (additive)

Drop the six new tables, their trigger functions and enums, and the
`_prisma_migrations` rows. A Cloud Run rollback does **not** undo a migration.
