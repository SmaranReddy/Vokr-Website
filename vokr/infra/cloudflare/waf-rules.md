# Cloudflare edge rules (plan §5 Phase 16, tasks 7–8)

Source of truth: `waf-rules.mjs` (payloads + runner); tests:
`src/server/net/__tests__/waf-rules.test.ts`. **Status 19 Oct 2026: written,
not applied.** Applying them is a production change for the owner (or this
environment with an explicit go-ahead and a zone-scoped token).

| # | Rule | Action | Why |
|---|---|---|---|
| 1 | `/api/checkout/*`, `/api/payments/*`, `/checkout` from outside India | managed challenge | Vokr ships only within India; a real traveller can still pass the challenge |
| 2 | `/admin*`, `/api/admin*` | block outside `ADMIN_IPS`, or challenge if no list | Defence in depth on top of the proxy's 404 gate |
| 3 | `POST /api/orders/lookup`, `POST /api/returns/*` | rate limit: 5 / 10 s per IP + colo, block 10 s | Edge burst limit ahead of the app's own limits (Free plan: one rule, 10 s period) |
| 4 | `POST /api/*` with a user agent under 10 chars or a scripting client | managed challenge | Cheap filter on scripted abuse; the webhook, CSP reports, Scheduler and health paths are exempt |
| 5 | Scanner probes (`/.env`, `/.git`, `/wp-`, `.php`, `/phpmyadmin`, `/cgi-bin`), plus `BAD_ASNS` on `/api/*` if given | block | None of these paths exist; no ASN is guessed |

All expressions use `lower(http.request.uri.path)`. Cloudflare's URL
normalisation (on by default) decodes `%61dmin` first.

## Apply (owner)

1. Create an API token scoped to **the `vokr.shop` zone only**, with
   *Zone → WAF: Edit* (covers custom rules and rate-limit rulesets). Keep it out of the repo.
2. Dry run, then review: `node infra/cloudflare/waf-rules.mjs`
3. Apply: `CF_API_TOKEN=… CF_ZONE_ID=… ADMIN_IPS="<your IPs>" node infra/cloudflare/waf-rules.mjs --apply`.
   This **replaces** both entrypoints. The runner prints any existing rules first, so
   check that nothing hand-made is lost.
4. Verify from the public internet (Phase 16 exit criterion):
   - `curl -s -o /dev/null -w '%{http_code}' https://vokr.shop/.env` returns 403.
   - `curl -X POST -A curl https://vokr.shop/api/marketing/newsletter` gets a challenge (403 with `cf-mitigated: challenge`).
   - Six quick `POST /api/orders/lookup` return 429 from Cloudflare.
   - `/admin` from a non-listed IP returns 403.
   - The storefront still loads normally from India.
5. Watch *Security → Events* for a day for false positives.

## Not applied, and why

- **Bot Fight Mode (task 8).** On the Free plan it cannot be skipped per
  path, and it can challenge server-to-server callers such as the Razorpay
  webhook. Enable it only after a webhook delivery has been proven through
  it, once payments resume. Until then rules 4–5 are the bot filter.
- **Managed challenge on auth and lookup paths (task 8).** A challenge
  breaks `fetch()` from the page (no HTML to solve). Rule 3's rate limit
  is the edge control there instead.
