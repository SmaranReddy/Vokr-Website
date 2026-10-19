# Release checklist: PRs #38, #49, #51 (three additive migrations)

Rehearsal already done (local only):
`docs/infrastructure/REHEARSAL-pr38.md` on PR #38.
- #38 alone, and #38 → #49 → #51 in ship order, against a restore of
  `C:\Users\Asus\vokr-backups\supabase-pre-pr35-*`: all applied.
- `migrate diff` was empty for #38 alone. For the combined pass, both
  databases' schemas came out identical.
- That backup is from 16 Oct, so it is **stale for release**. Take a fresh one.

| Order | PR | Migration | Approval needed before merge |
|---|---|---|---|
| 1 | #38 invoices | `20261017060130_invoices` | **CA review** of the invoice and credit-note format, plus D2 (GST rate and HSN per SKU) and D3 (legal name, GSTIN, address, state). |
| 2 | #49 returns/RTO | `20261017143950_returns_rto` | Owner: return-form copy (DRAFT), shipping-refund policy for returns |
| 3 | #51 privacy | `20261019041009_privacy_dpdp` | **Legal review** (`docs/privacy/legal-review-proposal.md` Q1–Q8). Erasure execution and retention purge stay off by code constant until then. |

**Release sequence (per CLAUDE.md), once all three are approved:**
1. Fresh `pg_dump` of production, with SHA-256 recorded (method: `vokr-backups/*/meta/`).
2. Restore it to a throwaway local PG. Apply all three in the order above, and
   confirm `migrate status` is up to date and `migrate diff` is empty on the
   merged `schema.prisma` (it needs a small merge: #38, #49 and #51 all add
   relations on `Order`).
3. Merge in order: #38 → #49 → #51, each with CI green on the merge result.
4. Cancel the push-run. Dispatch `deploy.yml` with `apply_migrations=true` once,
   after the last merge.
5. Prove the pending set out of band: exactly these three.
6. Owner approves the `production` gate.
7. Verify read-only afterwards: 13 migrations, RLS on the new tables, the
   append-only triggers present, orphan counts 0, Scheduler run `ok=true`.

Cloud Run rollback does not reverse a migration. All three are additive, so
rolling back the code leaves the new tables unused.

If only some of the three are approved, they can ship separately in the same
order. Each migration touches only its own tables.
