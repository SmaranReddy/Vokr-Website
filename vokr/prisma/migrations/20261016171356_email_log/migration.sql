-- CreateEnum
CREATE TYPE "email_template" AS ENUM ('order_confirmation');

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('pending', 'sending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "email_log" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "template" "email_template" NOT NULL,
    "status" "email_status" NOT NULL DEFAULT 'pending',
    "recipient_hash" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_log_status_updated_at_idx" ON "email_log"("status", "updated_at");

-- CreateIndex
CREATE INDEX "email_log_sent_at_idx" ON "email_log"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_log_order_id_template_key" ON "email_log"("order_id", "template");

-- AddForeignKey
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line (Prisma has no CHECK primitive).
-- Purely additive: two enums, one new table with its indexes, FK, CHECKs
-- and RLS. No backfill (production holds no orders).
-- ---------------------------------------------------------------------

ALTER TABLE "email_log"
  ADD CONSTRAINT "email_log_attempts_non_negative" CHECK ("attempts" >= 0);

-- A sent email records when, to whom (as a hash) and Brevo's message id.
ALTER TABLE "email_log"
  ADD CONSTRAINT "email_log_sent_is_complete"
    CHECK ("status" <> 'sent' OR ("sent_at" IS NOT NULL AND "recipient_hash" IS NOT NULL AND "provider_message_id" IS NOT NULL));

-- Only a SHA-256 hex digest is ever stored, never an address.
ALTER TABLE "email_log"
  ADD CONSTRAINT "email_log_recipient_is_a_hash"
    CHECK ("recipient_hash" IS NULL OR "recipient_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "email_log" ENABLE ROW LEVEL SECURITY;
