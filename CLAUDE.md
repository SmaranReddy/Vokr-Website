# Vokr — project instructions for Claude Code

Indian D2C footwear storefront (Next.js app in `vokr/`). Real money, real
inventory, real customer PII. Engineering rules and commands live in
`vokr/AGENTS.md` (loaded by `vokr/CLAUDE.md`) — read it; do not duplicate it here.

## Sources of truth (in order)

1. `Vokr-Implementation-Plan.md` **on `master`** — status, scope, decisions
   (§0.3), definition of done (§12), launch gate (§13). §0 "Checkpoint" is the
   short current-state summary; phase `#### Status` blocks hold the evidence.
2. `Vokr-Zero-Cost-Production-Tech-Stack-and-Readiness-Checklist.pdf` — architecture.
3. `vokr/docs/infrastructure/*.md` — runbooks (deploy, Cloud Run, late payments, DNS).

Handovers and memory are clues, not proof. Re-verify Git, GitHub, Cloud Run,
Scheduler and migration state before any consequential action. Label claims
verified / reported / assumed / unresolved.

## Where to work

- **Never modify the OneDrive working tree** (`…\OneDrive\Desktop\Vokr Website`):
  it is a stale branch with uncommitted owner changes. No clean/reset/checkout there.
- Work in worktrees under `C:\Users\Asus\vokr-worktrees\` (main one: `…\main`).
  Start fresh sessions there so this file is discovered.
- New branch from `origin/master` → `git branch --unset-upstream`, then push
  with `git push -u origin <branch>`. Never push to `master` directly, never force-push.
- Run `npm` from PowerShell (Git Bash `npm run` is broken on this machine).
  Integration tests use Compose Postgres on port 55432 with a per-worktree DB name.
- gcloud: always `--project vokr-website` (default account/project is wrong).

## Autonomy and authorization

- Own execution: pick the next unblocked item from the plan, implement, test,
  review, record evidence, open/update a PR, continue. Don't stop at a roadmap.
- Ask the owner only for real decisions, missing credentials, or authorization.
  Check §0.3 first; give a recommendation and its consequence; record the answer.
- **Needs explicit owner authorization each time:** merging to `master`,
  approving the `production` environment gate (never approve it yourself),
  production SQL, DNS/IAM/secret/Cloud Run/Scheduler changes, anything that
  charges, refunds, emails or ships for real.
- **Invariants:** `ORDERING_ENABLED=false` and `RAZORPAY_LIVE_MODE_ALLOWED=false`
  until every launch gate passes and the owner authorizes. Server-side price
  and stock are authoritative; reservation/payment changes are transactional,
  idempotent and concurrency-safe. Never oversell, never mark an unfulfillable
  paid checkout as an order, never release stock while payment is pending or
  unknown, never treat an ambiguous payment status as a confirmed refund.
  Late captures without a valid hold are fully refunded (D12, owner policy).
- Never invent tax, legal, seller, price, shipping or fulfilment policy (D2, D3, D11…).
- Never commit secrets, credentials, data dumps or keys.

## Production migrations

Fresh `pg_dump` with verified hashes → restore to an isolated DB → rehearse the
migration → merge → cancel the push-run → dispatch `deploy.yml` with
`apply_migrations=true` → prove the pending set out of band → owner approves
the gate. Cloud Run rollback does not reverse a migration. Backups live in
`C:\Users\Asus\vokr-backups\` (method scripts in each backup's `meta/`).

## Models, review, verification

- Opus: architecture, payments/refunds, inventory concurrency, migrations,
  security, release decisions, integration, final review. Sonnet (via the
  Agent tool, when it is genuinely used): bounded UI/test/doc work with an
  exact contract; Opus inspects and integrates the result. Never claim a
  delegation or model switch that did not happen.
- Use the `advisor` tool (when present) as an independent reviewer before
  committing to an approach and before declaring done — especially for
  payments, inventory, migrations and security. If unavailable, say so.
- Checks: `npm run verify` (lint, typecheck, unit, build) and
  `npm run test:integration`. Fix failures; never weaken assertions or skip CI.
  Report mocked vs integration vs CI vs provider-sandbox vs production evidence honestly.
- A route is done when its behaviour works (states, a11y, responsive, access
  control, truthful copy) — not when it renders.

## Continuity

Update the plan (§0 Checkpoint + the phase Status) with evidence when a
milestone lands. Before compaction or handoff: commit/push work in progress,
record branch/commit/PR/CI/production facts, blockers and the next exact task
in the plan checkpoint, and give the owner a short resume prompt.
