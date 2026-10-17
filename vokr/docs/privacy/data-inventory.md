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
| Rate-limit buckets | `rate_limit_counters.key` — **some keys contain a raw IP or email** | Abuse protection | 24 hours | No (transient) |
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
- **Not built yet:**
  - **Erasure** — must anonymise PII in place while keeping orders,
    invoices and credit notes for 8 years, and delete the Supabase Auth
    user (needs the service-role key). A real tension with tax retention:
    owner and legal review first.
  - **Guest export** — guests own data only through a device session and
    order number + email; a verified guest flow is not designed.
  - **Consent records** (task 1–3), the grievance path (task 10), and the
    privacy-policy update (task 11).

## Findings to act on

1. `rate_limit_counters.key` stores raw emails/IPs (24 h). Hashing the
   key would remove them with no loss of function.
2. `audit_log` has no retention rule yet.
3. The Shiprocket CSV is a PII file on the operator's machine — the
   runbook says delete after upload; nothing enforces it.
