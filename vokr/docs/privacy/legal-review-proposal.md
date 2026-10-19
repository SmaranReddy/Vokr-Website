# Privacy / DPDP: questions for legal and CA review

Plan §5 Phase 17 (R22). The system is built so that **nothing irreversible
happens before these are answered**: erasure execution is off
(`ERASURE_EXECUTION_ENABLED = false`, `src/server/privacy/erasure.ts`), and
retention purging is off (`RETENTION_PURGE_ENABLED = false`,
`src/server/privacy/retention.ts`). Both are code constants. Turning either
on is a reviewed change that cites the answer it relies on.

**Statutory figures below are marked _to confirm_.** None was checked
against a primary source (the bare Act or the notified Rules) in this
session. They record the engineering team's understanding, so counsel can
confirm or correct each one rather than draft from scratch.

## What exists today (so the questions are concrete)

- **Consent records**, append-only (`consent_records`; a trigger refuses
  UPDATE and DELETE). Two purposes are recorded:
  - `account_terms`: at sign-up, before the account is created, because
    terms §1 says creating an account is acceptance of the Terms and the
    Privacy Policy;
  - `marketing_email`: at the footer newsletter, before the Brevo subscribe call.

  Each row holds the purpose, the policy version (its "Last updated"
  label), the source, a SHA-256 of the email, and a SHA-256 of the IP.
- **Erasure:** a signed-in customer requests it (`POST /api/privacy/delete`).
  An operator reads a dry-run report and approves or rejects, retyping the
  account email (audited). Execution then anonymises in place:
  - **Tombstoned:** account email, name and phone; saved addresses; the
    order contact email and ship-to phone.
  - **Kept:** the order, its totals, payment and history, the ship-to name
    and address, and consent records.
  - **Blocked** while an order is being fulfilled, a checkout holds stock,
    or a refund is open.
- **Retention:** a report-only step in the 5-minute maintenance job counts
  guest sessions, carts, stale checkout emails, audit rows over a year old,
  and consents of accounts erased over a year ago.
- **Logs:** Cloud Logging's default is 30 days. An export script exists
  (`scripts/ops/export-logs-to-r2.sh`, dry run by default). It has not been
  run, and it needs R2 credentials.
- **Export:** `POST /api/privacy/export` is live. It now also includes
  consent records and privacy requests.

## Questions

**Q1. What must an order keep after erasure, and for how long?**

- **Our understanding (to confirm):**
  - CGST Act 2017 s.36 requires books and records to be kept for 72 months
    from the due date of the annual return for the year concerned.
  - Companies Act 2013 s.128(5) requires books of account for 8 financial years.
  - The plan's "8 years" comes from the latter.
- **To decide:**
  - Must a B2C tax invoice's recipient name and address be retained for
    that whole period?
  - Is the ship-to **phone** part of that record? We erase it today.
  - Which retention period applies to Vokr's entity type (D3)?
- **Decides:** whether `executeErasure` may also tombstone the ship-to
  name and address, or must keep them (current behaviour).

**Q2. Erasure vs. retention: what do we tell the customer?**

- **To decide:**
  - Is in-place anonymisation, with the financial record kept, an
    acceptable answer to a DPDP s.12 erasure request?
  - What exact wording does the privacy policy need? Plan §9 requires
    stating the conflict plainly.
- **Also to decide:** may consent records outlive erasure as proof of
  consent ("life of the account + 1 year", plan §3.5), given they hold
  only a hash of the email?

**Q3. Is checkout a consent point?**

- **Our position:** placing an order processes data to perform the
  contract and deliver it (a legitimate use). No consent is recorded at
  checkout.
- **To confirm:** is a notice enough, and must the notice be shown at the
  address step?

**Q4. Cookies and analytics.**

- **Today:** the site sets only strictly necessary cookies (session,
  guest bag, CSRF-safe auth) and runs no analytics.
- **To confirm:**
  - that no banner is needed while that stays true;
  - which purposes a banner must offer if analytics are added later.

**Q5. Log retention period and content.**

- **Our understanding (to confirm):** the DPDP Rules 2025 require a data
  fiduciary to keep logs of personal-data processing for at least one year.
- **To decide:**
  - Do request logs with IPs and ids fall under that?
  - What is the maximum retention, so the R2 lifecycle rule can delete them?
  - Is the R2 export (Cloudflare, data possibly outside India) acceptable,
    or should logs stay in a GCP `asia-south1` log bucket with 365-day
    retention instead? That second option is an owner cost decision.

**Q6. Grievance officer and response time.**

- **Statutory, to confirm:** the time limit for responding to a data
  principal's grievance under the Act and Rules, and whether the officer
  must be named on the site.
- **To decide (owner):**
  - who staffs `grievance@vokr.shop`;
  - a published SLA. Our proposal is acknowledgement within 2 business
    days, and resolution within the statutory limit.
- **Note:** an email sender being verified in Brevo does not prove the
  inbox exists. Someone has to receive and answer.

**Q7. Verified guest requests.**

- **Background:** guests own data only through a device session and order
  number + email. Export and erasure are built for signed-in accounts only.
- **To decide:** is a guest request handled by the support inbox with
  manual identity checks (our proposal), or must it be self-service?

**Q8. Rate-limit and consent hashes.**

- **Background:** these are unsalted SHA-256 digests. That is
  pseudonymised, not anonymised: a known email or IPv4 address can be
  matched against them.
- **To decide:** is a keyed HMAC (a secret held in Secret Manager)
  required before launch, or is the current design acceptable given the
  24-hour and consent-lifetime retention?

## After the answers

1. Update the privacy policy to describe the implementation (task 11).
2. Set `ERASURE_EXECUTION_ENABLED` and `RETENTION_PURGE_ENABLED` in a
   reviewed PR that cites the answers.
3. Add the Supabase Auth user deletion: it needs the service-role key in
   Secret Manager. Until then it is a manual step listed in each erasure
   report, and the session layer treats an erased account as signed out.
