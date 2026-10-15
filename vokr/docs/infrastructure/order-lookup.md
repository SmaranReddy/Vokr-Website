# Guest order lookup

Plan §5 Phase 9, task 6. Code: `src/server/orders/lookup.ts`,
`src/app/api/orders/lookup/route.ts`; tests:
`src/server/orders/__tests__/lookup.integration.test.ts`,
`lookup-route.test.ts`.

## What protects it
- **Gated** by `ORDERING_ENABLED` (403 while the storefront is browse-only).
- **One answer per kind of failure:** every miss (unknown number, wrong email,
  malformed number) returns the same 404 body. Every limit returns the same 429
  body, with no reset time.
- **Constant-time second factor:** email digests are compared with
  `timingSafeEqual`. A miss decrypts a dummy ciphertext, so it costs the same.
- **Uniform timing:** every response, success included, takes at least 800 ms
  (`LOOKUP_MIN_DURATION_MS`).
- **Limits**, taken before the lookup:
  - 20 per 15 minutes per client IP. The IP is trusted only on
    origin-verified requests (`client-ip.ts`).
  - 10 per hour per order number. This counts every attempt on that number,
    real or not, so a lockout reveals nothing about whether the order exists.
- **The view holds no name, phone or email.** It shows status, timeline,
  items, totals, and city/state/PIN only.

## Known trade-offs (owner to review before launch)
- **Lockout can be used to deny tracking.** Order numbers are sequential, so
  anyone can lock any order's tracking for an hour with about 10 requests.
- **Lockout counts successes too.** A customer who checks very often can lock
  themselves out for an hour. This is stricter than the plan's "after repeated
  failures".
- Alternatives that remove both problems:
  - signed-in order history (task 7), which needs no lookup;
  - order emails (Phase 11).
  - Counting only failures would be possible once those exist.
- **Logging volume:** each 404 writes one warn line (`orders/lookup NOT_FOUND`),
  with no PII. An enumeration flood therefore costs Cloud Logging volume, which
  the per-IP limit bounds.

## Launch checklist items this raises
- The Order Status page copy promises emails ("You'll get an email…",
  "tracking details by email"). Phase 11 (Brevo) must be live before
  `ORDERING_ENABLED` flips, or that copy becomes a false claim.
- If ordering is ever paused after launch, lookup is paused with it. Keeping
  tracking available then needs its own switch.
