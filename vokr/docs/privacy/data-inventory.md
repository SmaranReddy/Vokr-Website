# Personal data inventory

Plan §5 Phase 17, task 9 (DPDP). The database half is enforced in code:
`src/server/privacy/inventory.ts` lists every personal-data column, and
`src/server/privacy/__tests__/inventory.test.ts` reads `prisma/schema.prisma`
and fails if a personal-data column is added without an entry. This page
adds the stores outside the database. **Pending legal review** (Phase 17
dependency) — it describes what the system does, not a legal position.

## In Vokr's Postgres (Supabase)

Encrypted columns (`…Enc`) use AES-256-GCM at the application layer; a
database dump shows ciphertext only.

| Data | Columns | Why | Retention | In the export |
|---|---|---|---|---|
| Account email, display name, phone | `app_users.email`, `display_name`, `phone_enc` | Sign-in, order updates, delivery | Life of the account | Yes |
| Saved addresses | `addresses.name_enc`, `line1_enc`, `line2_enc`, `phone_enc`, `city`, `state`, `pincode` | Delivery, serviceability | Life of the account | Yes |
| Checkout contact email | `checkout_sessions.contact_email_enc` | Order updates, guest lookup | With the session | Yes |
| Order contact and ship-to | `orders.contact_email_enc`, `ship_name_enc`, `ship_phone_enc`, `ship_line1_enc`, `ship_line2_enc`, `ship_city`, `ship_state`, `ship_pincode` | Delivery, tax invoice | **8 years** (tax records) | Yes |
| Email send records | `email_log.recipient_hash` (SHA-256 only, never the address or body) | One email per event | 180 days after sending | Records yes, hash no |
| Guest device session | `guest_sessions.token_hash` | Guest bag | Until expiry | No (credential hash) |
| Rate-limit buckets | `rate_limit_counters.key` — action scope + unsalted SHA-256 digest of the IP/email/id; raw values never stored, but this is **pseudonymised, not anonymised** (a known email or IPv4 address can be hashed and matched) | Abuse protection | 24 hours | No (transient) |
| Consent records | `consent_records.subject_hash` (SHA-256 of the email), `ip_hash` (SHA-256 of the IP), purpose, policy version, source — **append-only** (trigger) | Proof of consent per purpose (DPDP) | Life of the account + 1 year (§3.5); kept through erasure pending legal review | Yes (records; hashes no) |
| Privacy requests | `data_subject_requests` — account id, kind, state, decision, counts-only report; no PII | Handling erasure requests | Not yet pruned | Yes |
| Operator audit | `audit_log` (actor = admin id; a PII reveal records *that* it happened, never the data) | Accountability | Not yet pruned | No (operator record) |

## Outside the database

| Store | Personal data | Why | Retention | Export path |
|---|---|---|---|---|
| Supabase Auth (`auth.users`) | Email, password hash, sign-in timestamps, OAuth identity | Authentication | Life of the account | Not in Vokr's export — Supabase dashboard |
| Brevo | Newsletter contacts (email); transactional email logs (recipient, subject); contact-form messages | Email delivery | Brevo's retention | Brevo dashboard |
| Zoho Mail (`support@`) | Contact-form messages (name, email, message) | Support | Mailbox retention | Mailbox |
| Razorpay | Payment details (card/UPI handled by Razorpay, not Vokr), payer contact | Payments | Razorpay's (regulatory) | Razorpay dashboard |
| Shiprocket | Name, phone, address, email (bulk CSV upload) | Shipping | Shiprocket's | Shiprocket panel |
| Shiprocket CSV on the operator's computer | Same as above | Upload | **Delete after upload** (runbook) | — |
| Cloud Logging | Request ids, user/order ids, IP in request logs; **no** emails, addresses or bodies by design | Operations | Cloud Logging default (30 days) | Not exported |
| Backups (`vokr-backups`, operator machine) | Full database dumps (PII encrypted at rest except the plain columns above) | Recovery | Until deleted | — |

## Data-subject rights — what exists

- **Export (built):** `POST /api/privacy/export` — a signed-in customer
  downloads everything in the Postgres table above as JSON, decrypted, with
  the exclusions and their reasons listed in the file. Nothing is stored;
  rate limited per account and per IP.
- **Consent (built):** recorded before the action it covers, at sign-up
  (`account_terms`; terms §1) and the footer newsletter (`marketing_email`).
  Withdrawal is a new row. Checkout and cookies are not consent points
  today. See `legal-review-proposal.md` Q3/Q4.
- **Erasure (built, execution off):** `POST /api/privacy/delete` records a
  request. An admin reads the dry run (`GET /api/admin/privacy/requests/[id]`)
  and approves or rejects it (`…/decide`, email retyped, recent sign-in,
  audited). `…/execute` anonymises in place, but answers 409 while
  `ERASURE_EXECUTION_ENABLED` is `false` (until legal review, Q1/Q2).
  - **Tombstoned:** account email, name and phone; saved addresses; the
    order contact email and ship-to phone.
  - **Kept:** the order, its totals, payment and history, the ship-to name
    and address (the tax invoice's recipient) and consent records.
  - **Manual steps:** delete the Supabase Auth user (service-role key) and
    the Brevo contact. Until then the session layer treats the erased
    account as signed out.
- **Retention (report-only):** the maintenance job's `retention` step counts
  guest sessions (90 days), open carts (30 days), checkout emails on
  sessions that never became an order (30 days), audit rows over a year old,
  and consents of accounts erased over a year ago. Purging
  (`RETENTION_PURGE_ENABLED`, off) only ever clears those checkout emails.
- **Logs:** `scripts/ops/export-logs-to-r2.sh` (dry run by default; needs
  R2 credentials; not scheduled). Default Cloud Logging retention is still
  30 days.
- **Not built yet:**
  - **Guest export/erasure:** guests own data only through a device session
    and order number + email; proposed as a manual support process (Q7).
  - The grievance path (task 10) and the privacy-policy update (task 11),
    both after legal review.

## Findings to act on

1. `rate_limit_counters.key` no longer stores raw emails/IPs — only an
   unsalted digest (`storedRateLimitKey`). That is pseudonymisation, not
   anonymisation: the rows are still personal data for their 24 hours. A
   keyed HMAC with a secret would close that; legal review to decide.
2. `audit_log` has no retention rule yet (counted by the retention report).
3. The Shiprocket CSV is a PII file on the operator's machine — the
   runbook says delete after upload; nothing enforces it.
