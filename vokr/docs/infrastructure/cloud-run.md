# Cloud Run — production runtime

Phase 20 tasks 1, 2, 4 (`../../../Vokr-Implementation-Plan.md`). The
configuration below is the PDF's §1 row for Hosting, verified through the
API rather than the console.

## Live configuration

| Field            | Value                                                                    | Source of the requirement                         |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Project          | `vokr-website` (`978877857702`)                                          | —                                                 |
| Service / region | `vokr` / `asia-south1` (Mumbai)                                          | PDF §1                                            |
| `min-instances`  | 0                                                                        | PDF §1; §10 upgrade trigger, deliberately not 1   |
| `max-instances`  | **3**                                                                    | PDF §1, **R4**                                    |
| CPU / memory     | 1 vCPU / 512 MiB                                                         | PDF §1                                            |
| Concurrency      | 80                                                                       | PDF §1                                            |
| Request timeout  | 300 s                                                                    | Phase 20 task 1                                   |
| Container port   | 3000                                                                     | `Dockerfile`                                      |
| Runtime identity | `vokr-cloud-run@vokr-website.iam.gserviceaccount.com`                    | Phase 20 security: **not** the default compute SA |
| Ingress          | `all`                                                                    | see "Origin exposure" below                       |
| Secrets          | `DATABASE_URL` ← Secret Manager `DATABASE_URL:latest`                    | **R3**                                            |
| Startup probe    | `httpGet /api/health`, delay 5 s, timeout 5 s, period 10 s, threshold 12 | this pass                                         |
| Image reference  | by **digest**, not tag                                                   | this pass                                         |

Verify, never from the console:

```bash
gcloud run services describe vokr --project=vokr-website --region=asia-south1 --format=json
```

## The startup probe is a database probe

`/api/health` runs `prisma.$queryRaw\`SELECT 1\`` (AGENTS.md: "the
keep-warm health check must touch Postgres, not just Cloud Run"). Because
the startup probe targets it, a revision that cannot reach Supabase never
becomes ready and never receives traffic — the previous revision keeps
serving instead. The default TCP-on-:3000 probe it replaced would have
accepted such a revision.

That also makes every successful deploy positive evidence that the running
revision reaches the real Supabase database.

## The image is referenced by digest

The service spec points at `…/vokr@sha256:…`, not at a tag. A tag can be
moved, and the registry cleanup policy can sweep one — which is exactly
what happened to the commit-SHA tag this service was originally deployed
with (`artifact-registry.md`). A digest cannot change underneath a running
service.

## Rollback

```bash
# What is serving, and what else could serve
gcloud run revisions list --service=vokr --project=vokr-website --region=asia-south1

# Send all traffic back to a named revision
gcloud run services update-traffic vokr \
  --project=vokr-website --region=asia-south1 \
  --to-revisions=REVISION_NAME=100
```

`deploy.yml` performs exactly this automatically when a deploy or its
smoke test fails, and asserts afterwards that traffic actually moved.

A rollback **pins** traffic to a named revision. To return to "latest"
afterwards, use `--to-latest`, not a named revision — a deploy made while
traffic is pinned creates its new revision at 0% (`deploy.yml` now routes
`--to-latest` explicitly and asserts it; see `cicd.md`).

### Drill — practised 11 Sep 2026 (Phase 19 task 13)

Real production traffic, not a tagged zero-traffic URL. Evidence below is
from the Cloud Run request log, not only from the commands' exit codes.

| Step                                                 | Time (UTC)  | Result                                                   |
| ---------------------------------------------------- | ----------- | -------------------------------------------------------- |
| Starting state                                       | 12:00:36.7  | `vokr-00010-rdd` 100%, latest                            |
| `update-traffic --to-revisions=vokr-00009-vdq=100`   | 12:00:44.4  | exit 0, **7.6 s**; service reports `vokr-00009-vdq` 100% |
| 6 probes (`/api/health`, `/`, `/api/cart`, twice)    | 12:00:45–50 | all 200; **log: all six served by `vokr-00009-vdq`**     |
| `npm run smoke-test` against the rolled-back service | —           | PASS 4/4                                                 |
| `update-traffic --to-latest`                         | 12:00:59.2  | exit 0, **6.5 s**; `vokr-00010-rdd` 100%, latest         |
| 6 probes                                             | 12:01:00–06 | all 200; **log: all six served by `vokr-00010-rdd`**     |
| `npm run smoke-test` against the restored service    | 12:01:07.9  | PASS 4/4                                                 |

Time to roll back: **7.6 s** of command time, first request confirmed on
the old revision 1.6 s later. Production sat on the rollback revision for
about 15 s and was left exactly as found (`latestRevision: true`).
`vokr-00009-vdq` is the pre-`49f817f` build; it served `/api/cart` 200
because the cart schema now exists in production.

## Keep-warm

Phase 20 task 4, job 1 of 3. Cloud Scheduler job `vokr-keep-warm`
(`asia-south1`), `*/5 * * * *`, `Asia/Kolkata`, `GET /api/health`,
authenticated with an OIDC token issued to
`vokr-scheduler@vokr-website.iam.gserviceaccount.com` (granted
`roles/run.invoker` on the service). Because `/api/health` touches
Postgres, one job prevents both Cloud Run cold starts and Supabase's
7-day inactivity pause.

The job currently targets `https://vokr-plxgen7xla-el.a.run.app` — the
temporary Cloud Run hostname. **Re-point it at the production origin when
the domain cuts over** (`domain-and-dns.md`):

```bash
gcloud scheduler jobs update http vokr-keep-warm \
  --project=vokr-website --location=asia-south1 \
  --uri='https://vokr.shop/api/health' \
  --oidc-token-audience='https://vokr.shop'
```

Jobs 2 (`pg_dump` → R2, Phase 18) and 3 (reservation expiry + row pruning,
Phase 8) are not created — the application code they would call does not
exist yet. Three free jobs per billing account; one is in use.

## Billing guardrail (R4)

Budget `vokr-website spend guardrail`
(`billingAccounts/0186FE-763C1B-A6406E/budgets/d3a6647b-8c72-4638-84c4-31ecd6f7454d`),
scoped to `projects/978877857702` only, monthly calendar period,
₹2,000 with thresholds at 5% / 25% / 100%. The billing account's currency
is INR, so the PDF's "$1 / $5 / $20" is expressed as ₹100 / ₹500 / ₹2,000.
Notifications go to the billing account's default `roles/billing.admin`
recipients; no separate Pub/Sub or monitoring channel is configured.

**An alert has still never been observed firing.** The plan's own standard
("an untested alert is not an alert") is therefore not met, and R4 stays
open on that clause. Every threshold is `CURRENT_SPEND`, so an alert can
only fire once real spend crosses it; forcing one means lowering the
budget below actual spend, which e-mails the billing admins — a deliberate
act for a person with billing access, not a side effect of a deploy.
Re-read 11 Sep 2026: unchanged (₹2,000; 5% / 25% / 100%; project-scoped).

## Origin exposure — open (D9)

Ingress is `all`, so `https://vokr-plxgen7xla-el.a.run.app` is reachable
directly. Phase 20 task 10 requires the origin to be unreachable except
through Cloudflare, so the WAF cannot be bypassed. That cannot be
configured before the edge exists — see `domain-and-dns.md`, which also
records that Cloud Run domain mapping is **not available in
`asia-south1`**. Tightening ingress today would take the only working
production URL offline.

**A concrete consequence today:** `src/server/net/client-ip.ts` trusts
`cf-connecting-ip`, then the first `x-forwarded-for` entry, from any
caller. Because the origin is reachable without Cloudflare, those headers
are caller-controlled, and the per-IP half of the R13 rate limiting can be
sidestepped by varying them. The fix belongs with the D9 edge (trust a
client IP only on requests proven to come through it) and is application
code; it is recorded here, not changed by infrastructure work.
