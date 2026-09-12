# Domain, DNS and the edge — measured state, D9, and what is blocked

Phase 20 tasks 5–10 (`../../../Vokr-Implementation-Plan.md`), plan §3.7,
§0.3 **D9**. **No DNS record, nameserver, Cloudflare setting or Cloud Run
traffic setting has been changed for the domain.** This file records the
measured state and the exact external actions required, so that nobody has
to guess a zone ID, an account, or a record.

## Measured state — 11 Sep 2026, read-only

Resolved against `1.1.1.1`; HTTPS probed directly.

```
NS    vokr.shop            aster.dns-parking.com, helios.dns-parking.com    (Hostinger)
A     vokr.shop            84.32.84.24, 88.222.222.33                        (Hostinger)
CNAME www.vokr.shop        www.vokr.shop.cdn.hstgr.net                       (Hostinger CDN)
MX    vokr.shop            mx.zoho.in (10), mx2.zoho.in (20), mx3.zoho.in (30)
TXT   vokr.shop            v=spf1 include:zoho.in ~all
                           zoho-verification=zb10135958.zmverify.zoho.in
                           brevo-code:79bc379f44ef9f105455b2455eb55f6c
TXT   _dmarc.vokr.shop     v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com
CNAME brevo1._domainkey    b1.vokr-shop.dkim.brevo.com
CNAME brevo2._domainkey    b2.vokr-shop.dkim.brevo.com
GET   https://vokr.shop/   200 · server: hcdn · platform: hostinger · 19,927,942 bytes
```

- `vokr.shop` is served by **Hostinger**: the 19.9 MB legacy homepage
  (`index (7).html`), not this application. The apex A records differ from
  the 10 Sep reading (`147.79.69.89`, `93.127.173.135`) — still Hostinger.
- The Next.js application is reachable only at
  `https://vokr-plxgen7xla-el.a.run.app`. Cloud Run has **0** domain
  mappings.
- **Cloudflare is not in the picture at all** — no zone, no delegation, no
  credentials in this environment.
- Zoho inbound mail is live and must not be disturbed. `grievance@` is a
  statutory requirement (plan §9).

## Email authentication — SPF does not need Brevo

**Correction to the 10 Sep entry**, which called the SPF record a defect
and proposed `v=spf1 include:zoho.in include:spf.brevo.com ~all`. Brevo's
own help centre ("Authenticate your domain with Brevo"):

> The SPF and MX records are not required to authenticate a domain. We
> only provide these records when setting up a dedicated IP.

Brevo authenticates a domain with the **Brevo code, DKIM and DMARC**, and
sends with its own envelope sender, so SPF is evaluated against Brevo's
domain rather than `vokr.shop`. All three records Brevo asks for are
published (above). The proposed merged SPF record is therefore **not an
approved record and must not be added** — `v=spf1 include:zoho.in ~all`
is correct as it stands, and it is the record Zoho depends on.

What R12 still needs is not a DNS change:

1. The Brevo dashboard reporting the domain **authenticated** (only Brevo
   can say this — records resolving is not verification).
2. Brevo configured as Supabase Auth custom SMTP.
3. A real confirmation email arriving in an inbox outside the project team.

None of these can be checked from here — there is no Brevo access in this
environment.

## D9 — the edge architecture

### Two facts that change the options recorded on 10 Sep

1. **Cloud Run domain mapping does not exist in `asia-south1`.** Google's
   documentation lists the supported regions (`asia-east1`,
   `asia-northeast1`, `asia-southeast1`, `europe-north1`, `europe-west1`,
   `europe-west4`, `us-central1`, `us-east1`, `us-east4`, `us-west1`) and
   states the feature is Preview and "not production-ready". The 10 Sep
   note inferred availability from the API returning `NOT_FOUND` for the
   domain rather than a region error; that inference was wrong. Option (a)
   as recorded in §0.3 is not available.
2. **Cloudflare Free cannot rewrite the `Host` header.** Origin Rules on
   Free support only destination-port override; Host, SNI and DNS-record
   overrides are paid features. Cloud Run answers only for its own
   hostname, so a proxied DNS record pointing `vokr.shop` at `*.run.app`
   reaches Google and gets a 404.

### The options that remain

| Option                                                                                                     | Origin bypass                                                           | Monthly cost                                                                                                                 | Added parts                                                     |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **1. Cloudflare Worker as the reverse proxy** (recommended)                                                | Closed **at the application**: `run.app` still resolves but answers 403 | **$0** up to 100,000 requests/day (Workers Free); **$5** (Workers Paid) beyond                                               | ~30-line Worker, one shared secret, one check in `src/proxy.ts` |
| 2. Global external Application Load Balancer + serverless NEG, ingress `internal-and-cloud-load-balancing` | Closed **at the network**: `run.app` refuses internet traffic           | ~**US$18+** for the forwarding rule alone, plus data processing (Cloud Armor extra) — breaks the zero-cost premise           | Load balancer, NEG, certificate, static IP                      |
| 3. Cloudflare Tunnel                                                                                       | Closed                                                                  | Needs an always-on host: Cloud Run `min-instances` (rejected, ADR-010) or a VM (the free e2-micro exists only in US regions) | A connector host to run and patch                               |
| ~~Cloud Run domain mapping~~                                                                               | —                                                                       | —                                                                                                                            | Not available in `asia-south1`                                  |

### Recommendation: option 1

**In plain terms.** Cloudflare becomes the front door for `vokr.shop`.
Every visitor talks to Cloudflare, which handles HTTPS, blocks attacks and
bots, and caches what is safe to cache. A small Cloudflare program (a
Worker) passes each remaining request on to Cloud Run and attaches a secret
password to it. The Vokr application refuses any request that does not
carry that password. So even though the Cloud Run web address still exists
on the internet, going around Cloudflare gets you nothing but an error.

**Does the `*.run.app` URL stay publicly reachable?** Yes — the hostname
keeps resolving. Cloud Run has no setting that admits only Cloudflare's IP
ranges; only a Google load balancer (option 2) can close it at the network.

**Is leaving it public a meaningful problem?** Today, yes, and concretely.
`src/server/net/client-ip.ts` trusts `cf-connecting-ip`, then the first
`x-forwarded-for` entry, from any caller. On the directly reachable
`run.app` URL anyone can set those headers, so the per-IP rate limits that
R13 relies on can be sidestepped by sending a different fake IP each time.
The other bypass effects are skipping the WAF, bot protection and the cache
(Mumbai egress is billed per GiB); `max-instances=3` bounds what that can
cost. With option 1, the application trusts a client IP only on requests
that carry the Worker's secret, and rejects everything else.

**Cost and limits.** $0 at launch scale. The ceiling is 100,000 Worker
requests per day, and every request to `vokr.shop` counts — page, script,
stylesheet — whether or not Cloudflare serves it from cache. At roughly 20
requests per page view that is about 5,000 page views a day (ESTIMATE —
measure it). Beyond the limit Cloudflare returns **error 1027 until 00:00
UTC**, a hard stop in the same class as Supabase's 402. So this option
needs a usage alert, and the $5/month Workers Paid upgrade pre-authorised
in the same way the plan pre-authorises Supabase Pro.

**Why not option 2.** It is the cleanest security design — no application
code, the origin simply is not on the internet — but it costs about
US$18/month permanently from day one, for protection that option 1
delivers for $0 as long as one application check is correct and tested.
It remains the upgrade path if traffic outgrows the Worker allowance or if
network-level isolation becomes a requirement.

**Option 1's own risk, stated plainly.** Its protection depends on the
application's secret check being right. That check must be covered by
tests — a request to `run.app` without the secret returns 403, a forged
`cf-connecting-ip` is ignored — before the domain cuts over.

## D9 decided — 11 Sep 2026

**Option 1, the Cloudflare Worker, was adopted by the manager on 11 Sep 2026. The paid load balancer is rejected** (plan §0.3 D9, ADR-031).

**Checked against the PDF and the plan.** PDF §1 names _Cloudflare Free_
as the edge (DNS, CDN, WAF, SSL, bot protection). A Worker is a feature of
that same free plan, not a new vendor, and it holds no application code —
the application still deploys only to Cloud Run, so this is not the
rejected "Cloudflare Pages as a separate deploy target". Cost stays $0
within 100,000 requests/day.

**Access check — stopped here.** Checked 11 Sep 2026, presence only: no
Cloudflare API token or account ID in the session or the persistent user
or machine environment, no `wrangler` or `cloudflared` login on this
machine, and no Hostinger API token. **No Cloudflare, Hostinger, DNS or
nameserver change was made.**

**Prepared, not deployed:** `vokr/infra/cloudflare/`

- `edge-worker.mjs` — forwards each request to the Cloud Run hostname,
  overwrites the `x-vokr-origin-auth` header with the Worker secret, sets
  `x-forwarded-host`/`x-forwarded-proto`, and rewrites absolute redirects
  that name the origin back to the public host. Fails closed (503) if
  either setting is missing.
- `wrangler.toml` — custom domain `vokr.shop`, `workers_dev = false`, no
  account ID, zone ID or secret committed.
- `edge-worker.test.mjs` — 6/6 pass, including a live case that proxies a
  real `GET /api/health` to production through the Worker code (on Node's
  fetch; not yet run inside workerd).

**Not done — needs its own approval.** Closing the bypass needs the
application to refuse requests without the secret (`src/proxy.ts`) and to
trust a client IP only on those requests (`src/server/net/client-ip.ts`).
Both files belong to completed Phase 3, which this task was told not to
modify. It also needs a decision on where the secret lives on the Cloud
Run side: a seventh Secret Manager secret (needs an ADR against the
six-version rule, ~$0.06/month), or a plain Cloud Run environment variable.
Until then the Worker proxies correctly but `run.app` stays bypassable.

**Records Cloudflare must hold before delegation** — public DNS cannot
list a zone, so these are only what probing found:

| Record                                         | Value (11 Sep 2026)                                  | At cutover                                                              |
| ---------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| MX ×3                                          | `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 30  | copy exactly (TTL today 14400)                                          |
| TXT apex                                       | SPF, `zoho-verification=…`, `brevo-code:…`           | copy exactly                                                            |
| TXT `_dmarc`                                   | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`   | copy exactly                                                            |
| CNAME `brevo1._domainkey`, `brevo2._domainkey` | `b1`/`b2.vokr-shop.dkim.brevo.com`                   | copy, **DNS-only (grey cloud)**                                         |
| A / AAAA apex                                  | Hostinger (`84.32.84.24`, `88.222.222.33`, two AAAA) | **do not copy** — the Worker custom domain replaces them                |
| CNAME `www`                                    | `www.vokr.shop.cdn.hstgr.net`                        | replace with a redirect to the apex (a free Redirect Rule)              |
| A `ftp`                                        | `157.173.216.210` (Hostinger)                        | copy, or drop if the Hostinger hosting is being retired — your decision |
| Zoho DKIM                                      | **not found** under the common selectors             | must come from the Hostinger zone listing or Zoho's admin console       |

**Hence the first thing needed from Hostinger is the complete record list
for `vokr.shop`** (hPanel → Domains → `vokr.shop` → DNS / Nameservers),
not only the nameserver change.

## What is required, in order

Nothing later can start before the item above it.

1. **Approve an edge architecture** — option 1 (recommended) or option 2.
2. **A Cloudflare account** on the Free plan, with `vokr.shop` added as a
   site. Either do the dashboard steps yourself, or give this environment
   an API token scoped to the `vokr.shop` zone only: Zone → DNS Edit, Zone
   Settings Edit, Firewall/WAF Edit, and Account → Workers Scripts Edit,
   Workers Routes Edit. Do not share the global API key. Nobody should
   guess a zone ID or account ID.
3. **Recreate every record above in the Cloudflare zone before delegating**
   — MX ×3, SPF, `zoho-verification`, `brevo-code`, `_dmarc`, and both
   Brevo DKIM CNAMEs. The DKIM CNAMEs **must be DNS-only (grey cloud)**: a
   proxied CNAME answers with Cloudflare's addresses and DKIM lookups
   fail. Verify each record by querying Cloudflare's assigned nameservers
   directly.
4. **Decide what happens to the Hostinger-served site** at `vokr.shop` and
   `www.vokr.shop`. The cutover replaces it with this application.
5. **Change the nameservers at Hostinger** to the two Cloudflare assigns.
   Requires Hostinger access. Irreversible on a timescale of hours (TTL
   and propagation); mail breaks if step 3 was incomplete.
6. **Re-verify mail after cutover** — all five Zoho mailboxes, `grievance@`
   especially — and Brevo's authentication status.

Then the engineering, which needs no further access: the Worker and its
secret; the origin check and client-IP trust in the application (its own
branch — it is application code); SSL Full (strict); HSTS (recommended
without `preload` at first — preload is very slow to undo — then preload
once stable, as the plan requires); cache rules that bypass `/api/*`,
`/checkout/*`, `/admin/*` and anything identity-bearing; the keep-warm job
re-pointed (`cloud-run.md`). The Phase 16 WAF rules and the Google OAuth
redirect (Phase 20 task 12) remain with their own phases.

## Status

D9 is decided. **11 Sep 2026, later same day:** `vokr.shop` has been added
to Cloudflare and its DNS records hand-edited by the domain owner (not by
this environment, which still holds no Cloudflare API token or account
ID) to the target state below. Reviewed against a screenshot of the
Cloudflare "Review your DNS records" screen, not queried live:

- Old Hostinger apex A/AAAA (×4) and the `ftp` A record: **removed.**
- `brevo1._domainkey` / `brevo2._domainkey`: **DNS-only**, content
  unchanged.
- `www` CNAME: repointed from Hostinger's CDN to `vokr.shop`, kept
  **Proxied**; a redirect rule (`www` → apex) created.
- Zoho MX ×3, SPF, `zoho-verification`, `brevo-code`, `_dmarc`: present,
  unchanged, DNS-only.
- Zoho DKIM: **found** as `zmail._domainkey` (TXT), closing the "selector
  not found" gap recorded on 11 Sep.

**Nameservers are still Hostinger's** (`aster`/`helios.dns-parking.com`)
— the Cloudflare zone is not authoritative and is not serving any
traffic yet. **The Worker has not been deployed** (`wrangler`/API token
not available in this environment). `https://vokr.shop/` is **not**
serving the Vokr application and is not verified. Any claim otherwise
would be fabricated.

**Remaining before cutover:** click Cloudflare's own DNS-safety
confirmation and "Continue to activation"; change the two nameservers at
Hostinger (needs Hostinger access this environment does not have); once
active, deploy `vokr/infra/cloudflare/` with a real `CLOUDFLARE_API_TOKEN`
/ `CLOUDFLARE_ACCOUNT_ID` and an `ORIGIN_AUTH_SECRET`; ship the
application-side origin check (`src/proxy.ts`,
`src/server/net/client-ip.ts` — Phase 3 files, needs its own approval);
re-verify all five Zoho mailboxes and Brevo's authentication status after
the nameserver change.

**12 Sep 2026 — updated, see Vokr-Implementation-Plan.md's "SIXTH PASS"
for the full record.** Cloudflare access was supplied. The Worker is
deployed (script `vokr-edge`, zone `5a4aa976bc53a628879dea5ed6eaf85a`,
custom domain `vokr.shop` attached) and proven end-to-end against the
real Cloud Run origin over Cloudflare's own edge (a temporary
`workers.dev` test, disabled again immediately after). `ORIGIN_AUTH_SECRET`
now lives in Secret Manager (`vokr-website` project, ADR-032 for the
seventh-secret exception) and on the Worker; Cloud Run has it mounted
(revision `vokr-00013-6fk`). The application-side check this file called
"not done — needs its own approval" **is now implemented and unit-tested**
(`src/server/net/origin-auth.ts`, `src/proxy.ts`,
`src/server/net/client-ip.ts`) but **not yet deployed** — it is
uncommitted in the working tree, so Cloud Run is still running the
pre-existing image and `run.app` remains bypassable until it is committed,
pushed and built through CI/CD. Zone status is still `pending` and
Hostinger's nameservers are unchanged — nothing here has touched
Hostinger.
