# Cloudflare edge rules (plan §5 Phase 16, tasks 7–8)

Source of truth: `waf-rules.mjs` (payloads + runner); tests:
`src/server/net/__tests__/waf-rules.test.ts`.

**Status 19 Oct 2026: rules 1, 2, 4 and 5 are live on `vokr.shop`; rule 3
(rate limit) is deferred** because the Free plan cannot express it (below).

| # | Rule | Action | Why | Live? |
|---|---|---|---|---|
| 1 | `/api/checkout/*`, `/api/payments/*`, `/checkout` from outside India | managed challenge | Vokr ships only within India; a real traveller can still pass the challenge | yes |
| 2 | `/admin*`, `/api/admin*` | block outside `ADMIN_IPS`, or challenge if no list | Defence in depth on top of the proxy's 404 gate | yes — **challenge** variant (no IP list given) |
| 3 | `POST /api/orders/lookup`, `POST /api/returns/*` | rate limit: 5 / 10 s per IP + colo, block 10 s | Edge burst limit ahead of the app's own limits | **no — deferred** |
| 4 | `POST /api/*` with a user agent under 10 chars or a scripting client | managed challenge | Cheap filter on scripted abuse; the webhook, CSP reports, Scheduler and health paths are exempt | yes |
| 5 | Scanner probes (`/.env`, `/.git`, `/wp-`, `.php`, `/phpmyadmin`, `/cgi-bin`), plus `BAD_ASNS` on `/api/*` if given | block | None of these paths exist; no ASN is guessed | yes — no ASN clause (none given) |

All expressions use `lower(http.request.uri.path)`. Cloudflare's URL
normalisation (on by default) decodes `%61dmin` first.

## What is deployed (19 Oct 2026)

Zone entrypoint ruleset for phase `http_request_firewall_custom`, version 1,
created with `POST /zones/{zone_id}/rulesets` (it did not exist; nothing was
replaced). Rule order: `vokr-1`, `vokr-2`, `vokr-4`, `vokr-5`, all enabled.
Each rule's description, expression and action were read back and compared
byte-for-byte with `customRules()` (no `ADMIN_IPS`, no `BAD_ASNS`); all four
matched. A second run of the same create-if-missing script found nothing
missing and wrote nothing. The zone's five pre-existing rulesets (managed
normalisation, managed free ruleset, DDoS L7, the `www` redirect, cache
settings) kept their versions and timestamps. The `http_ratelimit`
entrypoint does not exist.

Bot Fight Mode, DNS and every other zone setting were not touched. Ordering
and payments stay disabled (`ORDERING_ENABLED=false`; Razorpay parked).

### Tested behaviour (19 Oct 2026, from an India IP, `loc=IN` per `/cdn-cgi/trace`)

| Rule | Request | Before | After | Ray ID (after) |
|---|---|---|---|---|
| 5 | `GET /.env` | 404 | 403 block | `a4d1555e0d2e44bb` |
| 5 | `GET /wp-login.php` | 404 | 403 block | `a4d15561c92dce36` |
| 4 | `POST /api/__waf-probe`, UA `curl/8.4.0` | 404 | 403, `cf-mitigated: challenge` | `a4d15565ad198965` |
| 4 | `POST /api/__waf-probe`, UA `x` | 404 | 403, `cf-mitigated: challenge` | `a4d1556989bafda8` |
| 4 (exempt) | `POST /api/health`, UA `curl/8.4.0` | 405 | 405 (reaches the app) | — |
| 2 | `GET /admin` | 404 | 403, `cf-mitigated: challenge` | `a4d15572ed67ae9e` |
| 2 | `POST /api/admin/inventory/adjust`, browser UA, no clearance | — | 403, `cf-mitigated: challenge`, `text/html` | `a4d167d20e96f02d` |
| 1 | `GET /checkout` from India | 404 | 404 (not challenged) | — |

Rule 4 was probed on a non-existent path rather than a real form, so a
miss could not create a real signup. Rule 1 firing (a non-India source)
was **not** tested: no non-India vantage point was used, and no VPN or open
proxy. Unchanged after the rules went live: home, a PDP
(`/shop/kids-model-123`), the five support pages (all 200, enforced
`Content-Security-Policy`, no report-only header), and
`POST /api/checkout/session` from a browser still returns the app's
`403 ORDERING_UNAVAILABLE` (not a challenge).

Security Events could not be queried through the API: the token has Zone
Read and Zone WAF Read/Edit only, and the GraphQL query needs
**Zone → Analytics: Read**. Check the Ray IDs above in the dashboard
instead — see `docs/security/cloudflare-security-events.md`.

## Rule 3: deferred (Free-plan limitation)

The Free plan allows one rate-limiting rule whose expression may use only
the **Path** and **Verified Bot** fields
([availability table](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability));
`http.request.method` first appears on Business. Rule 3 filters on
`http.request.method eq "POST"`, so the API cannot accept it as written.
Dropping the method clause would also count `GET` requests, which changes
the reviewed rule, so it was not applied. `/api/returns/*` is not on
`master` yet either (PR #49).

Owner options: accept a path-only version (counts every method on those
two paths), upgrade the plan, or rely on the application limits in
`docs/security/rate-limit-matrix.md` (the lookup route already has
per-IP, per-number and timing-floor limits).

## Rule 2 and the admin pages

With no IP list, `/admin*` and `/api/admin*` are challenged. Checked
against the admin client code:

- The admin UI makes **no background or polling requests**. Its only API
  calls are user-initiated form submissions through
  `src/components/admin/use-admin-post.ts` (stock adjust, transition,
  refund, PII reveal), plus two Shiprocket CSV download links (top-level
  navigations).
- `cf_clearance` lasts **30 minutes** by Cloudflare's default (Security →
  Settings → Challenge Passage; this zone's value was not readable with
  the token used). Cloudflare's docs add an hour for XmlHTTP requests and
  do not say whether `fetch()` counts. Either way it is far shorter than
  an admin session (8 hours, `ADMIN_SESSION_MAX_AGE_S`). An operator
  who leaves a page open past the clearance and then submits a form gets a
  challenge instead of the API.
- A challenged `fetch()` gets `403`, `content-type: text/html`,
  `cf-mitigated: challenge` (probed above). `useAdminPost` cannot parse
  that as JSON, so it shows **"Request failed (403)."** The request never
  reached the origin, so **nothing was changed** — no partial refund,
  transition or stock change, and no audit row. Reloading the page shows
  the interactive challenge; once solved, the operator retries.
- Download links and page navigations show the challenge page directly.
  Client-side `<Link>` navigation and the `router.refresh()` after a
  successful submit fetch `/admin/*` in the background; a challenged one
  gets HTML instead of an RSC payload, and Next.js then falls back to a
  full page load, which shows the challenge (framework behaviour, not
  probed here with an admin session).

So it fails safe but with an unclear message. Recommendation, in order:

1. Keep rule 2 as it is (no live change needed). No admin has been granted
   yet, so it affects nobody today.
2. Small app PR before the first admin grant: in `useAdminPost`, if
   `response.headers.get("cf-mitigated") === "challenge"`, show "Security
   check expired — reload the page, then try again. Nothing was changed."
   (the detection Cloudflare documents for fetch/XHR).
3. Owner's call, and still owed: Phase 12's security requirement is a
   block outside a restricted set of IPs, which the challenge is not (anyone
   can pass it). Once the operator has stable addresses, set `ADMIN_IPS` to
   switch rule 2 to the block variant (it then blocks the operator on any
   other network, e.g. mobile data). Raising Challenge
   Passage is a zone setting and applies to every challenge, so it is not
   recommended for this alone.

## Apply / re-apply

1. API token scoped to **the `vokr.shop` zone only**, with
   *Zone → WAF: Edit* (covers custom rules and rate-limit rulesets). Add
   *Zone → Analytics: Read* to query Security Events. Keep it out of the repo.
2. Dry run, then review: `node infra/cloudflare/waf-rules.mjs`
3. The runner's `--apply` **replaces** both entrypoints (`PUT`) and also
   sends rule 3, which the Free plan rejects. Do not use it as is while
   rules are live. To add or fix one rule without touching the others:
   `GET .../rulesets/phases/http_request_firewall_custom/entrypoint`, then
   `POST /zones/{zone_id}/rulesets/{ruleset_id}/rules` for a missing rule
   (or `PATCH .../rules/{rule_id}` for one rule), matching on the
   `vokr-N:` description prefix.
4. Verify from the public internet with the table above, and watch
   Security Events for a day (`docs/security/cloudflare-security-events.md`).

## Not applied, and why

- **Rule 3** — see above.
- **Bot Fight Mode (task 8).** On the Free plan it cannot be skipped per
  path, and it can challenge server-to-server callers such as the Razorpay
  webhook. Enable it only after a webhook delivery has been proven through
  it, once payments resume. Until then rules 4–5 are the bot filter.
- **Managed challenge on auth and lookup paths (task 8).** A challenge
  breaks `fetch()` from the page (no HTML to solve). Rule 3's rate limit
  was meant to be the edge control there; until it exists, the
  application limits are.
