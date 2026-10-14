-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('razorpay');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'razorpay',
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'created',
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_checkout_session_id_key" ON "payments"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as every prior
-- migration: Prisma's schema language has no CHECK-constraint primitive.
-- ---------------------------------------------------------------------

-- A payment is always for a positive amount, in rupees: the only currency
-- the storefront prices in (plan §3.6). Razorpay rejects a zero amount
-- anyway; the CHECK catches the bug before the network call does.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_paise" > 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_currency_inr" CHECK ("currency" = 'INR');

-- A captured or refunded payment must name the Razorpay payment that got
-- it there — otherwise there is nothing to refund or reconcile against.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_settled_has_provider_payment"
    CHECK ("status" NOT IN ('captured', 'refunded') OR "provider_payment_id" IS NOT NULL);

-- Row Level Security, same convention as every prior migration — launch
-- access is via Prisma using a role that owns these tables and therefore
-- bypasses RLS by default. No policies defined yet.
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
