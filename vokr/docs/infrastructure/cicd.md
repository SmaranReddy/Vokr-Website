# CI/CD — GitHub Actions → Artifact Registry → Cloud Run

Phase 19 tasks 3, 4, 5, 7, 11, 12, 13 (`../../../Vokr-Implementation-Plan.md`).
Closes the infrastructure half of **R1**.

## The two workflows

| Workflow                       | Trigger                                 | What it does                                                                                                                                  |
| ------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`     | pull request → `master`                 | `lint`, `typecheck`, `test`, `build`, client-bundle secret-name scan, homepage weight budget, Docker build + boot. Nothing merges red.        |
| `.github/workflows/deploy.yml` | push → `master`, or `workflow_dispatch` | preflight → verify → build/push → **manual-approval** deploy to production: migration gate, deploy, assert, smoke test, roll back on failure. |

`deploy.yml` has four jobs, in order:

1. **preflight** — asserts every required repository variable is set, that
   `NEXT_PUBLIC_SITE_URL` is neither empty nor `localhost`, and that the
   target project is `vokr-website`. Fails in seconds rather than after a
   full image build.
2. **verify** — `lint`, `typecheck` and the unit tests, re-run on the exact
   commit being deployed. `master` is not branch-protected, so a commit
   that reached it without a green PR still cannot deploy. The homepage
   weight budget is a PR gate only — it is Phase 14 task 9 (R21), deferred
   and currently red, and is neither duplicated here nor weakened in
   `ci.yml`.
3. **build** — checks out `github.sha` exactly, refuses a dirty tree,
   authenticates by Workload Identity Federation, builds, asserts no `.env`
   file and no server-only variable name reached the image's client bundle,
   pushes tagged with the commit SHA, and resolves the **digest**.
4. **deploy** — gated on the `production` GitHub Environment. Records the
   currently serving revision as the rollback target, runs the **migration
   gate** (below), deploys **by digest**, routes 100% of traffic to the new
   revision explicitly, asserts `max-instances=3` / the dedicated runtime
   service account / that the revision actually serving runs the digest
   just built, runs `npm run smoke-test`, and on any failure after a deploy
   was attempted returns 100% of traffic to the recorded revision. On
   success it tags the digest `production`, which the registry cleanup
   policy keeps indefinitely.

Why the explicit traffic step: every rollback (`update-traffic
--to-revisions=REV=100`) pins traffic to a named revision. While it is
pinned, `gcloud run deploy` creates the new revision at **0%**, and a smoke
test against the service URL would pass against the _old_ code. The
workflow therefore runs `update-traffic --to-latest` after deploying and
asserts that the serving revision is the latest ready one, at 100%, running
the expected digest.

## The migration gate (task 11)

`vokr/scripts/migration-gate.sh`, run in the approval-gated `deploy` job
before any revision is created. It exists because Phase 5's code reached
production while its migration had never been applied, and `/api/cart`
returned 500 until the schema was fixed by hand.

| Mode    | When                                                   | Behaviour                                                                                                                                  |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `check` | every push to `master` (default)                       | Read-only `prisma migrate status`. Up to date → pass. Anything else → **fail; nothing is deployed.**                                       |
| `apply` | `workflow_dispatch` with `apply_migrations=true`, only | Pending migrations that are **purely additive** are applied with `prisma migrate deploy`; status must then read "up to date", or it fails. |

It fails closed on everything it does not positively recognise: failed or
modified migrations, drift, migrations in the database that this commit
does not have, unparseable output, and any pending migration containing a
non-additive statement (`DROP …`, `TRUNCATE`, `DELETE FROM`, `UPDATE`,
`RENAME`, a column `TYPE` change, `SET NOT NULL`). That is the
expand/contract rule from task 11: an expand step can ship through the
pipeline, and a contract step is applied by hand after a backup.

The connection is derived in-process from Secret Manager `DATABASE_URL`
(transaction pooler, 6543) as the **session pooler, 5432**, which
migrations require (README, "Database — real Supabase project"). It is
masked in the log and never written to disk. The gate asserts that Prisma
itself reports `…pooler.supabase.com:5432` as its datasource. No
`db seed`, no `supabase config push`.

**Before `apply`:** take a `pg_dump`. Phase 18 backups do not exist, and
Supabase Free has no PITR — see the Phase 5 production migration (plan §0.2)
for the procedure that was used.

**Staging:** task 11 says "staging then production". There is no staging
database (R5, not decided), so the gate runs against production only.

### Prerequisite not yet in place — one IAM binding

The gate reads `DATABASE_URL` as the deploy identity, which today has no
access to it. Until this binding exists, **every deploy fails at the
migration gate** — closed, with a message pointing here:

```bash
gcloud secrets add-iam-policy-binding DATABASE_URL \
  --project=vokr-website \
  --member='serviceAccount:github-deployer@vokr-website.iam.gserviceaccount.com' \
  --role='roles/secretmanager.secretAccessor'
```

Scoped to that one secret. It does not widen what the identity can reach:
`github-deployer` can already deploy a revision that runs as
`vokr-cloud-run@…`, which holds exactly this access. It was not applied
automatically in the 11 Sep pass (the change was refused by this
environment's permission policy) and is left for an explicit decision.

## No long-lived credentials

There are **no Actions secrets and no service-account JSON key**. GCP
access comes from Workload Identity Federation:

|                                |                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Pool                           | `projects/978877857702/locations/global/workloadIdentityPools/github-actions` |
| Provider                       | `.../providers/github`, issuer `https://token.actions.githubusercontent.com`  |
| Attribute condition            | `assertion.repository == 'SmaranReddy/Vokr-Website'`                          |
| Impersonated SA                | `github-deployer@vokr-website.iam.gserviceaccount.com`                        |
| That SA's roles                | `artifactregistry.writer`, `run.developer`, `iam.serviceAccountUser`          |
| `workloadIdentityUser` binding | `principalSet://.../attribute.repository/SmaranReddy/Vokr-Website` only       |
| Required APIs                  | IAM, Resource Manager, IAM Credentials, **Security Token Service**            |

The **Security Token Service API** (`sts.googleapis.com`) was not enabled
until 11 Sep 2026. Google's WIF guide lists it as required; without it the
first run would have failed at authentication. All four are now enabled.

All four service accounts have zero user-managed keys (checked 11 Sep
2026). Verify with:

```bash
gcloud iam service-accounts keys list \
  --iam-account=github-deployer@vokr-website.iam.gserviceaccount.com \
  --project=vokr-website --managed-by=user
```

Any output row is a violation.

## Repository variables — set 11 Sep 2026

All ten are **variables, not secrets** — none of them is secret. The
`NEXT_PUBLIC_*` values are inlined into every visitor's browser bundle by
definition; the rest are resource names. The one genuine secret,
`DATABASE_URL`, never leaves Secret Manager and is referenced by name only
(`--set-secrets=DATABASE_URL=DATABASE_URL:latest`).

```bash
gh variable set GCP_PROJECT_ID            --body 'vokr-website'
gh variable set GCP_REGION                --body 'asia-south1'
gh variable set AR_REPOSITORY             --body 'vokr'
gh variable set CLOUD_RUN_SERVICE         --body 'vokr'
gh variable set CLOUD_RUN_SERVICE_ACCOUNT --body 'vokr-cloud-run@vokr-website.iam.gserviceaccount.com'
gh variable set DEPLOY_SERVICE_ACCOUNT    --body 'github-deployer@vokr-website.iam.gserviceaccount.com'
gh variable set WIF_PROVIDER              --body 'projects/978877857702/locations/global/workloadIdentityPools/github-actions/providers/github'
gh variable set NEXT_PUBLIC_SITE_URL      --body 'https://vokr.shop'

# From the real Supabase project (Phase 2). Both are public values.
gh variable set NEXT_PUBLIC_SUPABASE_URL      --body '<https://<project-ref>.supabase.co>'
gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body '<the anon / publishable key>'
```

All ten were set on 11 Sep 2026, the two Supabase values from the same
source as the live build, and read back with `gh variable list`.
`deploy.yml` fails closed if any is missing — it will not substitute a
default and ship a misconfigured image.

## The `production` environment — created 11 Sep 2026

Phase 19 task 5 requires production to be a manual approval gate. The
`deploy` job declares `environment: production`, which now exists with:

- a **required reviewer** (`SmaranReddy`), and
- a **deployment branch policy** admitting `master` only.

```bash
gh api repos/SmaranReddy/Vokr-Website/environments/production
```

`prevent_self_review` is off, because the repository has one maintainer:
the gate is a deliberate human pause before production, not four-eyes
review. Adding a second reviewer and turning it on is the upgrade.

## Deploying by hand (discouraged)

If a manual deploy is ever unavoidable, run the guards first:

```bash
npm run deploy:check                                   # clean tree, commit on a remote
MODE=check GCP_PROJECT_ID=vokr-website bash scripts/migration-gate.sh
```

The first refuses a dirty working tree and a commit that exists on no
remote. The second refuses a database that does not match the commit's
migrations. Building outside them is how the service once reached a state
that corresponded to no reproducible commit — see `artifact-registry.md`.

## Not yet run, and why

| Item                                             | Blocker                                                                                                                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real end-to-end run of `deploy.yml`            | It triggers on `master`, which is still at Phase 2 (`4ec495f`). Advancing it means merging PR #1, whose only red check is the Phase 14 weight budget (R21) — "nothing merges red" versus a deferred gate is a human decision. |
| The migration gate inside the pipeline           | the IAM binding above                                                                                                                                                                                                         |
| Staging deploy on merge (task 4, first half)     | no staging environment exists (R5)                                                                                                                                                                                            |
| Razorpay sandbox-vs-live boot assertion (task 9) | Razorpay is not integrated until Phase 7                                                                                                                                                                                      |
