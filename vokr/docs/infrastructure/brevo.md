# Brevo — what the live newsletter and contact forms need

Plan §3.7.1, Phase 4 task 10 (the two forms), Phase 11 (transactional
email), R3, R12. First recorded 11 Sep 2026 (setup record, before any key
existed); failure behaviour and state updated 17 Oct 2026 — see below.

## What the deployed application does

| Route                            | Brevo call                                 | Payload                                                                                                      |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /api/marketing/newsletter` | `POST https://api.brevo.com/v3/contacts`   | `{ email, updateEnabled: true }` — no list ID, so the contact lands in the account's contact base on no list |
| `POST /api/marketing/contact`    | `POST https://api.brevo.com/v3/smtp/email` | sender **and** recipient `support@vokr.shop`, `replyTo` the visitor                                          |

Both read `BREVO_API_KEY` through `requireServerEnv()`
(`src/server/marketing/brevo.ts`).

### Failure behaviour (17 Oct 2026)

A form reports success **only** when Brevo accepted the request (2xx; for
the newsletter also `400 duplicate_parameter` = already subscribed — never
for the contact form). Everything else is HTTP **500** `INTERNAL_ERROR`
with the unchanged visitor-facing message and a `requestId`:

| Reason           | When                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `not_configured` | `BREVO_API_KEY` empty — no request is made                                 |
| `timeout`        | Brevo did not answer (headers **and** body) within `FORM_TIMEOUT_MS` = 8 s |
| `network`        | DNS/connection/TLS failure                                                 |
| `rejected`       | Any other HTTP status from Brevo (401 bad key, 403 IP/sender, 4xx, 5xx)    |
| `unexpected`     | A bug or anything else thrown on the way (also logged with its stack)      |

The **contact** send is one attempt only, no retry: it has no idempotency key, so a
retry could deliver the same message twice. The **newsletter** call is an
upsert (`updateEnabled: true`), so it is retried **once** on a transient failure
(timeout, network, 429, 5xx; never another 4xx): two 3.8 s attempts plus a
300 ms pause, inside the same 8 s budget. A **timed-out contact send may
still have been delivered** — if the visitor retries, the support inbox can
get a duplicate. Malformed JSON is a 400 (it used to be a 500 whose log
line quoted part of the body).

Each failure writes exactly one line at `error`:

```
[marketing/contact] FORM_DELIVERY_FAILED {"form":"contact","reason":"rejected","status":401,"code":"unauthorized","requestId":"…"}
```

It holds only the form, reason, Brevo's HTTP status, Brevo's machine
`code` (allowlisted to `[a-z_]`, never its free-text message, which can
echo the submitted email) and the request id. Never logged: the API key,
request headers, the visitor's name, email, order number or message, or
Brevo's response text. The `vokr_form_delivery_failed` metric counts these
lines (`alerting.md`). Validation (400) and rate-limit (429) refusals are
not delivery failures and keep their untagged `warn` line.

**Reading a failure:** `status 401` → wrong or revoked key (an SMTP key,
`xsmtpsib-…`, is also refused); `403` → the Authorised IPs restriction or
the sender is not allowed; `timeout`, `network` or 5xx → Brevo side,
usually transient.

## State (reported from the plan's §0 Checkpoint, 17 Oct 2026)

- `BREVO_API_KEY` v1 in Secret Manager, mounted on Cloud Run
  (`BREVO_API_KEY_READY=true`) since `vokr-00038-877`; sender
  `support@vokr.shop` active, `vokr.shop` authenticated.
- Both forms are therefore live against Brevo. The sections below are the
  original setup record (11 Sep 2026), kept for key rotation.

## What is required — all on the Brevo side, then one variable

1. **A Brevo API key (v3).** Brevo dashboard → your account menu → **SMTP &
   API** → **API keys** tab → **Generate a new API key**. It is the _API
   key_ (`xkeysib-…`), not the SMTP key. Brevo shows it once. **Do not
   paste it into chat, a file in the repository, or a terminal command
   line.**
2. **`support@vokr.shop` accepted as a sender.** Either the `vokr.shop`
   domain shows **Authenticated** under Senders, Domains & Dedicated IPs →
   Domains (the Brevo code, DKIM and DMARC records are already published —
   `domain-and-dns.md`), or `support@vokr.shop` is added and verified as a
   sender. Otherwise `/smtp/email` rejects the contact form.
3. **Transactional sending enabled** on the account. New Brevo accounts
   can be held for review before they may send.
4. **Authorised IPs not blocking Cloud Run.** If Brevo's "Authorised IPs"
   security setting is active, calls from unlisted IPs are refused. Cloud
   Run has no fixed egress IP, so that restriction must be off for this
   key.

## Adding the key without exposing it

Run this yourself, in your own PowerShell window (not through chat). It
prompts without echoing, writes a temporary file with no BOM and no
newline — the two faults that broke `DATABASE_URL` v1 and v2 — adds the
version, and deletes the file:

```powershell
$s = Read-Host 'Brevo API key' -AsSecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
$f = New-TemporaryFile
[IO.File]::WriteAllText($f.FullName, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
gcloud secrets versions add BREVO_API_KEY --data-file="$($f.FullName)" --project=vokr-website
Remove-Item $f.FullName
```

Then turn it on and deploy:

```bash
gh variable set BREVO_API_KEY_READY --body true --repo SmaranReddy/Vokr-Website
gh workflow run deploy.yml --repo SmaranReddy/Vokr-Website --ref master
```

`deploy.yml` adds `BREVO_API_KEY=BREVO_API_KEY:latest` to the revision's
secrets only while `BREVO_API_KEY_READY` is `true`, so nothing references
the secret before it has a value.

**Verify** with one real newsletter signup and one real contact message:
the contact appears in Brevo, and the message arrives in the Zoho
`support@` inbox.

**Rotation:** add a new version, then **disable** the old one — never
exceed six active Secret Manager versions (AGENTS.md).
