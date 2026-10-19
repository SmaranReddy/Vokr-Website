# Checking Cloudflare Security Events for false positives

For the custom WAF rules in `infra/cloudflare/waf-rules.md` (live since
19 Oct 2026). Free plan: the dashboard shows **sampled** events only, keeps
up to the last 31 days, and has no report export. Each event can be
expanded and exported as JSON; up to 500 sampled events can be exported.
Source: [Security Events](https://developers.cloudflare.com/waf/analytics/security-events/).

## Open it

1. Cloudflare dashboard → the `vokr.shop` zone → **Security → Analytics**,
   then the **Events** tab
   (`https://dash.cloudflare.com/?to=/:account/:zone/security/analytics`).
2. Set the time range. The default is the last 24 hours; a narrower range
   means less sampling.
3. **Add filter** → field, operator, value. Do not quote values; wildcards
   are not supported. Useful filters:
   - **Service** equals *Custom rules* — only our four rules.
   - **Action** equals *Block* or *Managed Challenge*.
   - **Rule** — the rule names start with `vokr-1`, `vokr-2`, `vokr-4`,
     `vokr-5`.
   - **Path**, **Country**, **User agent**, **IP address**, **ASN**.
   - **Ray ID**, to find one request (e.g. one a customer reports, from
     the error page footer). Cloudflare's page does not list this filter
     explicitly; if the field is not offered, filter by time and path and
     expand the events.
4. **Edit columns** to show Path, User agent, Country and ASN (the
   columns Cloudflare documents), so each row can be judged without
   expanding it.

The test requests from 19 Oct are a known baseline: Ray IDs
`a4d1555e0d2e44bb` and `a4d15561c92dce36` (rule 5 block),
`a4d15565ad198965`, `a4d1556989bafda8` (rule 4 challenge),
`a4d15572ed67ae9e`, `a4d167d20e96f02d` (rule 2 challenge). If these are
visible, the view is set up correctly. Sampled logs may omit some of them.

## What a false positive looks like, per rule

| Rule | Expected hits (fine) | Signs of a false positive — act on these |
|---|---|---|
| `vokr-5` block | `/.env`, `/.git/config`, `/wp-login.php`, `xmlrpc.php`, `/phpmyadmin`, `/cgi-bin/` from datacentre ASNs, many paths per IP | A **real page or asset** blocked: a product slug, image, font or `/_next/*` path that happens to contain `/wp-`, `/.git` or end in `.php`; a browser user agent loading a normal page just before |
| `vokr-4` challenge | `POST /api/*` from curl, python-requests, Go clients, empty or very short user agents | A **normal browser user agent** (Chrome, Safari, Firefox, Samsung Internet, in-app browsers) being challenged; or any hit on `/api/webhooks/razorpay`, `/api/csp-report`, `/api/jobs/maintenance`, `/api/health` (those are exempt — a hit means the exemption broke); or Google's Cloud Scheduler user agent anywhere |
| `vokr-2` challenge | Any `/admin*` or `/api/admin*` from the internet (scanners), and the operator's own visits, about one per clearance period (30 min at Cloudflare's default) | Repeated challenges for the **operator's own IP** shortly after solving one; a `POST /api/admin/*` challenge from the operator (they will have seen "Request failed (403)") |
| `vokr-1` challenge | Non-India traffic to `/checkout`, `/api/checkout/*`, `/api/payments/*` (none expected while ordering is off) | Country **IN** on a hit (should be impossible); or once ordering opens, many challenges from one country that real customers use (e.g. Indian travellers, carriers whose IPs geolocate abroad) |

Also check across all rules:

- **Challenge outcome.** The Free-plan view does not report a solve rate
  (not documented). A challenged IP that later shows normal page loads in
  the zone's traffic analytics was a person; a challenge with nothing after
  it was usually a bot. A real complaint plus a Ray ID is the best signal.
- **Volume spikes** on one rule right after a deploy usually mean a new
  path collides with a pattern — compare the paths against the app's
  routes (`src/server/__tests__/route-inventory.test.ts`).
- **Customer reports.** A blocked customer sees a Cloudflare page with a
  Ray ID; search for it here.

## What to record

For each suspected false positive: date/time (UTC), Ray ID, rule, path,
method, user agent, country, ASN, and why it looks legitimate. Use
**Export event JSON** on the event for the full record. Do not paste
customer IP addresses or emails into GitHub issues; give the Ray ID
instead.

## What to do about one

Do not edit the live rules by hand in the dashboard: `waf-rules.mjs` is
the source of truth. Change the expression there (narrow the pattern, or
add the path to `MACHINE_PATHS` for a machine caller), add a test in
`src/server/net/__tests__/waf-rules.test.ts`, review, then update only
that rule (`PATCH .../rulesets/{ruleset_id}/rules/{rule_id}`; see
`waf-rules.md` → Apply). For an immediate stop, the rule can be
**disabled** (not deleted) in Security → WAF → Custom rules, and the
change then recorded in `waf-rules.md`.

## Querying events by API (optional)

The GraphQL `firewallEventsAdaptive` dataset needs a token with
**Zone → Analytics: Read** in addition to WAF access. The token used on
19 Oct 2026 lacked it (`does not have permission ... zone.analytics.read`),
so the dashboard is the way to check for now.
