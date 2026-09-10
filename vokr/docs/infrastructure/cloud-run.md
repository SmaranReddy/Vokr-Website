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

**Not yet practised for real** (Phase 19 task 13). It requires two
revisions that are both legitimately servable and a deliberate drill.

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
open on that clause.

## Origin exposure — open

Ingress is `all`, so `https://vokr-plxgen7xla-el.a.run.app` is reachable
directly. Phase 20 task 10 requires the origin to be unreachable except
through Cloudflare, so the WAF cannot be bypassed. That cannot be
configured before the edge exists — see `domain-and-dns.md`. Tightening
ingress today would take the only working production URL offline.
