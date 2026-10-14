-- CreateEnum
CREATE TYPE "reservation_state" AS ENUM ('held', 'committed', 'released', 'expired');

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "state" "reservation_state" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_checkout_session_id_variant_id_key" ON "inventory_reservations"("checkout_session_id", "variant_id");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as every prior
-- migration: Prisma's schema language has no CHECK-constraint or
-- partial-index primitive.
-- ---------------------------------------------------------------------

-- A hold is always for at least one unit. The cart caps a line at 10, and
-- the reservation copies the priced line, so this only catches a bug.
ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0);

-- The expiry job's scan (plan §3.5): only live holds are ever looked up
-- by expiry, so only they are indexed.
CREATE INDEX "inventory_reservations_held_expires_at_idx"
  ON "inventory_reservations" ("expires_at") WHERE "state" = 'held';

-- Row Level Security, same convention as every prior migration — launch
-- access is via Prisma using a role that owns these tables and therefore
-- bypasses RLS by default. No policies defined yet.
ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;
