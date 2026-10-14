-- CreateEnum
CREATE TYPE "payment_issue_state" AS ENUM ('open', 'refund_initiated', 'refunded', 'manual_review');

-- CreateTable
CREATE TABLE "payment_issues" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "state" "payment_issue_state" NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "refund_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_issues_payment_id_key" ON "payment_issues"("payment_id");

-- CreateIndex
CREATE INDEX "payment_issues_state_created_at_idx" ON "payment_issues"("state", "created_at");

-- AddForeignKey
ALTER TABLE "payment_issues" ADD CONSTRAINT "payment_issues_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as every prior
-- migration: Prisma's schema language has no CHECK-constraint primitive.
--
-- Purely additive: a new enum, a new table, its indexes, FK, CHECKs and
-- RLS. Nothing existing is altered, so no backfill is needed (production
-- holds 0 payments, 14 Oct 2026).
-- ---------------------------------------------------------------------

-- The money on an issue is the payment's: positive and in rupees, the
-- same rules as `payments`.
ALTER TABLE "payment_issues"
  ADD CONSTRAINT "payment_issues_amount_positive" CHECK ("amount_paise" > 0);

ALTER TABLE "payment_issues"
  ADD CONSTRAINT "payment_issues_currency_inr" CHECK ("currency" = 'INR');

-- A refund in flight always names the Razorpay refund, so the job can
-- poll it rather than create a second one.
ALTER TABLE "payment_issues"
  ADD CONSTRAINT "payment_issues_refund_named"
    CHECK ("state" <> 'refund_initiated' OR "refund_id" IS NOT NULL);

-- Only a refunded issue is resolved; `manual_review` is still waiting on
-- a human.
ALTER TABLE "payment_issues"
  ADD CONSTRAINT "payment_issues_resolved_at"
    CHECK (("state" = 'refunded') = ("resolved_at" IS NOT NULL));

-- Row Level Security, same convention as every prior migration — launch
-- access is via Prisma using a role that owns these tables and therefore
-- bypasses RLS by default. No policies defined yet.
ALTER TABLE "payment_issues" ENABLE ROW LEVEL SECURITY;
