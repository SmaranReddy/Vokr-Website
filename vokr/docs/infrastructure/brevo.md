# Brevo — what the live newsletter and contact forms need

Plan §3.7.1, Phase 4 task 10 (the two forms), Phase 11 (transactional
email), R3, R12. Recorded 11 Sep 2026 by code inspection and a read of the
live configuration. **No Brevo account is accessible from this
environment, and no key has been created, read or stored.**

## What the deployed application does

| Route                            | Brevo call                                 | Payload                                                                                                      |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `POST /api/marketing/newsletter` | `POST https://api.brevo.com/v3/contacts`   | `{ email, updateEnabled: true }` — no list ID, so the contact lands in the account's contact base on no list |
| `POST /api/marketing/contact`    | `POST https://api.brevo.com/v3/smtp/email` | sender **and** recipient `support@vokr.shop`, `replyTo` the visitor                                          |

Both read `BREVO_API_KEY` through `requireServerEnv()`
(`src/server/marketing/brevo.ts`). Without it they throw
`InternalError("Newsletter/contact delivery is not configured.")` and the
form shows an error.

## State today

- Secret Manager `BREVO_API_KEY`: **0 versions.** The runtime service
  account already holds `secretAccessor` on it.
- Cloud Run does **not** mount it — only `DATABASE_URL` is mapped. Cloud
  Run refuses to create a revision that references a secret with no
  version, so it cannot be mapped before a real key exists.
- **Both forms therefore fail in production today.** (Code inspection; the
  endpoints were not exercised against production, to avoid writing
  rate-limit rows for a known outcome.)

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
