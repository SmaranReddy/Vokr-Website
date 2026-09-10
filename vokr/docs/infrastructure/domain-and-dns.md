# Domain, DNS and the edge — what is true, and what is blocked

Phase 20 tasks 5–10 (`../../../Vokr-Implementation-Plan.md`), plan §3.7.
**Nothing in this file has been changed by the deployment work.** It
records the measured state and the exact external actions required, so
that nobody has to guess a zone ID, an account, or a record.

## Measured state — audited, read-only

```
$ dig NS vokr.shop           helios.dns-parking.com, aster.dns-parking.com   (Hostinger)
$ dig A  vokr.shop           147.79.69.89, 93.127.173.135                    (Hostinger)
$ curl -sI https://vokr.shop/    HTTP/1.1 200 OK · platform: hostinger
$ dig MX vokr.shop           mx.zoho.in (10), mx2.zoho.in (20), mx3.zoho.in (30)
$ dig TXT vokr.shop          v=spf1 include:zoho.in ~all
                             zoho-verification=zb10135958.zmverify.zoho.in
                             brevo-code:79bc379f44ef9f105455b2455eb55f6c
```

So today:

- `vokr.shop` is served by **Hostinger**, not by Cloud Run. The Next.js
  application is reachable only at
  `https://vokr-plxgen7xla-el.a.run.app`.
- **Cloudflare is not in the picture at all** — no nameserver delegation,
  no zone, no account credentials in this environment.
- Zoho inbound mail is live and must not be disturbed. `grievance@` is a
  statutory requirement (plan §9).

## Defect found in the mail DNS

The published SPF record is `v=spf1 include:zoho.in ~all`. **Brevo is not
in it.** Plan §3.7.1 requires a _single merged_ SPF TXT record covering
both the inbound (Zoho) and outbound (Brevo) senders, because a domain may
publish only one. The Brevo verification TXT (`brevo-code:…`) is present,
which is a different thing and does not authorise sending.

Until the merged record is published and Brevo itself reports the domain
verified, **R12 stays open** and transactional/auth email is not
trustworthy in production. The merged form is:

```
v=spf1 include:zoho.in include:spf.brevo.com ~all
```

Publishing it is a Hostinger DNS change, and DKIM/DMARC still have to be
added and verified in the Brevo dashboard alongside it. Not done here —
no Hostinger access, and getting SPF wrong breaks inbound mail.

## The architectural decision nobody has made yet

Plan §3.7 records the conflict rather than resolving it: PDF §1 names
**Cloudflare Registrar + Cloudflare DNS/CDN/WAF/SSL**, while the domain
and its DNS live at **Hostinger**. Phase 20 must treat "move DNS to
Cloudflare" as an explicit migration with its own cutover, not as a
precondition.

There is a second, unresolved question underneath it. Phase 20 task 10
requires that the Cloud Run origin **not be reachable directly**, so the
WAF cannot be bypassed. A Cloud Run domain mapping does not give you
that — the `*.run.app` hostname stays public, and Cloud Run cannot
restrict ingress to Cloudflare's IP ranges without also breaking the
mapping. The realistic options are:

| Option                                                                                        | Origin hidden?                       | Cost                                          | Notes                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cloud Run domain mapping, Cloudflare proxied in front                                         | **No** — `*.run.app` stays reachable | free                                          | Simplest. Task 10's guarantee is not met; the WAF is bypassable by anyone who learns the run.app hostname. |
| Cloudflare Tunnel (`cloudflared`) to a private-ingress service                                | Yes                                  | free, but needs a container to run the tunnel | Adds a component the PDF does not list.                                                                    |
| External Application Load Balancer + Cloud Armor, ingress `internal-and-cloud-load-balancing` | Yes                                  | **not free** (~$18/mo forwarding rules)       | Breaks the zero-cost premise.                                                                              |

Domain mapping _is_ available in `asia-south1` (verified: the API accepts
the region and returns `NOT_FOUND` for the domain, not a region error).

**This is a manager decision, not an engineering one**, because two of the
three options change either the security guarantee or the cost model that
the PDF is built on.

## What is required from outside this environment

Ordered. Nothing later can start before the item above it.

1. **Decide the edge architecture** — one of the three rows above.
2. **Cloudflare account access.** No credentials exist here. Do not guess
   a zone ID or an account ID.
3. **Hostinger account access**, to either delegate nameservers to
   Cloudflare or add records in place.
4. **The nameserver decision itself.** Delegating `vokr.shop` to
   Cloudflare moves _all_ records, including the live Zoho MX and the SPF
   and verification TXTs. Mail breaks if they are not recreated correctly
   _before_ the cutover. This is irreversible on a timescale of hours
   (TTL + propagation) and must not be done casually.
5. **What happens to the current Hostinger-served site at `vokr.shop`.**
   Pointing the domain at Cloud Run replaces it.
6. **The merged SPF record + Brevo DKIM/DMARC**, then Brevo's own
   verification (R12).
7. **Zoho mailbox delivery re-verified after any cutover** — all five
   addresses, `grievance@` especially.

Only after 1–5 can any of this be done: HSTS with preload, cache rules
(bypass on `/api/*`, `/checkout/*`, `/admin/*` and anything
identity-bearing — a cached checkout page is a data leak), the Phase 16
WAF rules, bot protection, and the domain mapping itself.

## Status

`https://vokr.shop/` is **not** serving the Vokr application and is not
verified. Any claim otherwise would be fabricated.
