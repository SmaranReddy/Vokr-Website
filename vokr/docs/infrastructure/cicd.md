# CI/CD — GitHub Actions → Artifact Registry → Cloud Run

Phase 19 tasks 4, 5, 7 (`../../../Vokr-Implementation-Plan.md`). Closes the
infrastructure half of **R1**.

## The two workflows

| Workflow                       | Trigger                                 | What it does                                                                                                                           |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`     | pull request → `master`                 | `lint`, `typecheck`, `test`, `build`, client-bundle secret-name scan, homepage weight budget, Docker build + boot. Nothing merges red. |
| `.github/workflows/deploy.yml` | push → `master`, or `workflow_dispatch` | preflight → build/push → **manual-approval** deploy to production, assert, smoke test, roll back on failure.                           |

`deploy.yml` has three jobs, in order:

1. **preflight** — asserts every required repository variable is set, that
   `NEXT_PUBLIC_SITE_URL` is neither empty nor `localhost`, and that the
   target project is `vokr-website`. Fails in seconds rather than after a
   full image build.
2. **build** — checks out `github.sha` exactly, refuses a dirty tree,
   authenticates by Workload Identity Federation, builds, asserts no `.env`
   file reached the runtime image, pushes tagged with the commit SHA, and
   resolves the **digest**.
3. **deploy** — gated on the `production` GitHub Environment. Records the
   currently serving revision as the rollback target, deploys **by digest**
   (never by tag — a tag can be moved or swept by the registry cleanup
   policy), asserts `max-instances=3` / the dedicated runtime service
   account / that the live image is the digest just built, runs
   `npm run smoke-test`, and on any failure returns 100% of traffic to the
   recorded revision. On success it tags the digest `production`, which the
   registry cleanup policy keeps indefinitely.

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

Both service accounts have Google-managed (`SYSTEM_MANAGED`) keys only.
No downloadable key has ever been created. Verify with:

```bash
gcloud iam service-accounts keys list \
  --iam-account=github-deployer@vokr-website.iam.gserviceaccount.com \
  --project=vokr-website
```

Any row whose `KEY_TYPE` is `USER_MANAGED` is a violation.

## Required repository variables

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

`deploy.yml` fails closed if any is missing — it will not substitute a
default and ship a misconfigured image.

## The `production` environment

Phase 19 task 5 requires production to be a manual approval gate. The
`deploy` job declares `environment: production`; that only gates anything
once the environment exists **with a required reviewer**:

```bash
gh api -X PUT repos/SmaranReddy/Vokr-Website/environments/production \
  -f 'wait_timer=0' \
  -F 'reviewers[][type]=User' \
  -F "reviewers[][id]=$(gh api user --jq .id)"
```

Without a reviewer the gate is decorative and money paths auto-deploy.

## Deploying by hand (discouraged)

If a manual deploy is ever unavoidable, run the guard first:

```bash
npm run deploy:check
```

It refuses a dirty working tree and refuses a commit that exists on no
remote. Building outside it is how the service reached a state that
corresponded to no reproducible commit — see `artifact-registry.md`.

## Not yet wired, and why

| Item                                                   | Blocker                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `prisma migrate deploy` as a pre-deploy step (task 11) | needs a staging database; the R5 second Supabase project is not decided                                          |
| Staging deploy on merge (task 4, first half)           | no staging environment exists; inventing one was explicitly out of scope                                         |
| Razorpay sandbox-vs-live boot assertion (task 9)       | Razorpay is not integrated until Phase 7                                                                         |
| A real end-to-end run of either workflow               | `origin/master` is still at Phase 2 (`4ec495f`); nothing since has been pushed, so no workflow has ever executed |
