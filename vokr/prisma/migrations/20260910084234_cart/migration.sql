-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "guest_session_id" UUID,
    "status" "cart_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carts_updated_at_idx" ON "carts"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as the first
-- two migrations (Vokr-Implementation-Plan.md §5 Phase 2): Prisma's
-- schema language has no CHECK-constraint or partial-unique-index
-- primitive.
-- ---------------------------------------------------------------------

-- An *open* cart belongs to exactly one identity (plan §3.5 `carts` row).
-- Scoped to `status = 'open'` rather than every row: a `closed` cart (the
-- merge handler's outcome, src/server/cart/merge.ts) is a historical
-- record that legitimately outlives its guest session — sign-in deletes
-- the guest_sessions row immediately, which the guest_session_id FK's
-- ON DELETE SET NULL then nulls out on any cart still pointing at it,
-- closed ones included. Requiring an identity unconditionally made that
-- ordinary lifecycle event fail the CHECK; found by
-- src/server/cart/__tests__/merge.integration.test.ts.
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_has_an_identity"
    CHECK (
      "status" <> 'open' OR "user_id" IS NOT NULL OR "guest_session_id" IS NOT NULL
    );

-- "One open cart per identity" as a database guarantee, not an
-- application hope (plan §5 Phase 5, task 1) — a partial unique index
-- over only the `open` rows, so a closed (already-merged) cart never
-- blocks a new open one for the same identity.
CREATE UNIQUE INDEX "carts_one_open_per_user"
  ON "carts"("user_id")
  WHERE "status" = 'open' AND "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "carts_one_open_per_guest_session"
  ON "carts"("guest_session_id")
  WHERE "status" = 'open' AND "guest_session_id" IS NOT NULL;

-- Per-line quantity cap (plan §3.5 `cart_items` row, and Phase 5 task 4).
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_between_1_and_10"
    CHECK ("quantity" BETWEEN 1 AND 10);

-- Row Level Security, enabled from creation on every table — see the
-- first migration's identical note. Launch access is via Prisma using a
-- role that owns these tables and therefore bypasses RLS by default; this
-- guards against a future connection (e.g. a Supabase anon/authenticated
-- key) reaching these tables with no policy in place. No policies are
-- defined yet — nothing besides the owning role queries these tables at
-- this phase.
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
