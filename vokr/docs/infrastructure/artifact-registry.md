# Artifact Registry — `vokr` (`asia-south1`)

Phase 19 tasks 6 (**R2**). 0.5 GB is the tightest quota in the stack
(PDF §4), so the cleanup policy exists from the first push, not after the
registry fills.

The policy is version-controlled at
[`../../infra/artifact-registry-cleanup-policy.json`](../../infra/artifact-registry-cleanup-policy.json)
and applied with:

```bash
gcloud artifacts repositories set-cleanup-policies vokr \
  --project=vokr-website --location=asia-south1 \
  --policy=infra/artifact-registry-cleanup-policy.json \
  --no-dry-run
```

`--no-dry-run` matters: a dry-run policy reports what it would delete and
deletes nothing.

## The four rules

| Rule                          | Action | Condition                                |
| ----------------------------- | ------ | ---------------------------------------- |
| `keep-production-tag`         | KEEP   | tagged `production*`                     |
| `keep-2-most-recent-tagged`   | KEEP   | 2 most recent versions of package `vokr` |
| `delete-old-tagged`           | DELETE | tagged, older than 30 d                  |
| `delete-untagged-after-1-day` | DELETE | untagged, older than 1 d                 |

KEEP takes precedence over DELETE. `deploy.yml` tags every successful
production digest `production`, so the image a running service depends on
is protected permanently rather than by an age window.

## Why `delete-old-tagged` carries an age condition

It did not. The original policy was `DELETE` on `{tagState: TAGGED}` with
no `olderThan` and no `tagPrefixes`. By the time this was audited, the
repository held eight versions and **zero tags** — including the
commit-SHA tag the live Cloud Run service had been deployed with:

```
$ gcloud artifacts docker images describe .../vokr:b6f706bb0fb2211866b4c211aad9f13f171f327e
ERROR: Image not found.
```

Two consequences:

- The commit → image provenance the plan recorded was no longer verifiable
  from the registry.
- The digest the running revision pins (`sha256:447d1599…`) had become
  untagged, and was therefore in scope for `delete-untagged-after-1-day`.
  With `min-instances=0`, deleting it risks breaking cold starts on a
  live service.

Repaired in the same pass: the digest was re-tagged with its commit SHA
and with `production`, taking the mapping from Cloud Run's own record (the
service spec named the tag, the revision recorded the digest it resolved
to — neither value was inferred), and the policy was replaced with the
four rules above.

## Verify

```bash
gcloud artifacts repositories describe vokr \
  --project=vokr-website --location=asia-south1 \
  --format='value(cleanupPolicies,cleanupPolicyDryRun,sizeBytes)'

gcloud artifacts docker tags list \
  asia-south1-docker.pkg.dev/vokr-website/vokr/vokr --project=vokr-website
```

A repository with no tags at all is the failure signature above, not a
healthy steady state.

## Quota

R2 also asks for an alert at 400 MB of 500 MB. Artifact Registry storage
is not a metric Cloud Monitoring exposes as a quota alert on the free
tier; the budget alert in `cloud-run.md` catches the billing consequence
but not the storage threshold itself. **Open.** Current usage is well
inside the quota (~128 MB at audit time); check it with the `sizeBytes`
command above.
