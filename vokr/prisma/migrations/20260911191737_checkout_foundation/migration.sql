-- CreateEnum
CREATE TYPE "checkout_state" AS ENUM ('draft', 'address_captured', 'priced', 'reserved', 'payment_pending', 'paid', 'failed', 'expired', 'abandoned');

-- CreateEnum
CREATE TYPE "checkout_payment_method" AS ENUM ('prepaid', 'cod');

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name_enc" TEXT NOT NULL,
    "line1_enc" TEXT NOT NULL,
    "line2_enc" TEXT,
    "phone_enc" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "state" "checkout_state" NOT NULL DEFAULT 'draft',
    "address_id" UUID,
    "payment_method" "checkout_payment_method",
    "idempotency_key" TEXT NOT NULL,
    "pricing_snapshot" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serviceable_pincodes" (
    "pincode" TEXT NOT NULL,
    "cod_eligible" BOOLEAN NOT NULL,
    "estimated_delivery_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "serviceable_pincodes_pkey" PRIMARY KEY ("pincode")
);

-- CreateIndex
CREATE INDEX "addresses_pincode_idx" ON "addresses"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_idempotency_key_key" ON "checkout_sessions"("idempotency_key");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as the first
-- three migrations (Vokr-Implementation-Plan.md §5 Phase 2): Prisma's
-- schema language has no CHECK-constraint primitive.
-- ---------------------------------------------------------------------

-- A checkout session belongs to exactly one identity — the same shape as
-- `carts_has_an_identity` (Phase 5 migration), but unconditional: unlike a
-- cart, a checkout session has no "closed, identity already released"
-- state that legitimately has neither.
ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_has_an_identity"
    CHECK ("user_id" IS NOT NULL OR "guest_session_id" IS NOT NULL);

-- The pricing snapshot and its expiry are written together or not at all
-- (plan §5 Phase 6, task 7) — a snapshot with no expiry could be read as
-- valid forever; an expiry with no snapshot is meaningless.
ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_snapshot_and_expiry_together"
    CHECK (("pricing_snapshot" IS NULL) = ("expires_at" IS NULL));

-- Indian PIN format backstop (plan §5 Phase 6, task 2): 6 digits, first
-- digit 1-8 (postal circle 0 and 9 are not issued). The application layer
-- validates this on every write; the CHECK is the same defense-in-depth
-- pattern as `inventory`'s non-negative constraints (plan §3.5).
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_pincode_format"
    CHECK ("pincode" ~ '^[1-8][0-9]{5}$');

ALTER TABLE "serviceable_pincodes"
  ADD CONSTRAINT "serviceable_pincodes_pincode_format"
    CHECK ("pincode" ~ '^[1-8][0-9]{5}$');

-- Row Level Security, same convention as every prior migration — launch
-- access is via Prisma using a role that owns these tables and therefore
-- bypasses RLS by default. No policies defined yet.
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "checkout_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "serviceable_pincodes" ENABLE ROW LEVEL SECURITY;
