-- Order numbers (plan §5 Phase 9, task 2): `VK-` and the sequence value,
-- starting at 10001 so every number has at least five digits, like the
-- legacy UI's `VK-10234`. Never reused; a rolled-back insert leaves a gap,
-- which is acceptable for order numbers (invoice numbers, which must be
-- gap-free, are a separate counter in the invoicing slice).
CREATE SEQUENCE "order_number_seq" AS BIGINT START WITH 10001 MINVALUE 10001 NO CYCLE;

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded', 'rto');

-- AlterTable
ALTER TABLE "checkout_sessions" ADD COLUMN     "contact_email_enc" TEXT;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL DEFAULT ('VK-'::text || (nextval('order_number_seq'::regclass))::text),
    "checkout_session_id" UUID NOT NULL,
    "payment_id" UUID,
    "user_id" UUID,
    "status" "order_status" NOT NULL DEFAULT 'confirmed',
    "payment_method" "checkout_payment_method" NOT NULL,
    "contact_email_enc" TEXT NOT NULL,
    "ship_name_enc" TEXT NOT NULL,
    "ship_phone_enc" TEXT NOT NULL,
    "ship_line1_enc" TEXT NOT NULL,
    "ship_line2_enc" TEXT,
    "ship_city" TEXT NOT NULL,
    "ship_state" TEXT NOT NULL,
    "ship_pincode" TEXT NOT NULL,
    "ship_country" TEXT NOT NULL DEFAULT 'IN',
    "gst_split" TEXT NOT NULL,
    "seller_state" TEXT NOT NULL,
    "subtotal_paise" INTEGER NOT NULL,
    "tax_paise" INTEGER NOT NULL,
    "shipping_paise" INTEGER NOT NULL,
    "cod_fee_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "size_label" TEXT NOT NULL,
    "colorway" TEXT NOT NULL,
    "hsn_code" TEXT NOT NULL,
    "gst_rate_bps" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "line_subtotal_paise" INTEGER NOT NULL,
    "line_tax_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL,
    "sgst_paise" INTEGER NOT NULL,
    "igst_paise" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_session_id_key" ON "orders"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_payment_id_key" ON "orders"("payment_id");

-- CreateIndex
CREATE INDEX "orders_user_id_placed_at_idx" ON "orders"("user_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as every prior
-- migration: Prisma's schema language has no CHECK-constraint primitive.
--
-- Purely additive: a sequence, an enum, three new tables with their
-- indexes, FKs, CHECKs and RLS, and one nullable column on
-- `checkout_sessions`. No backfill: production holds no checkout sessions
-- or payments (ordering has never been enabled).
-- ---------------------------------------------------------------------

ALTER SEQUENCE "order_number_seq" OWNED BY "orders"."order_number";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_number_format" CHECK ("order_number" ~ '^VK-[0-9]{5,}$');

-- A prepaid order always names the captured payment that created it.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_prepaid_has_payment"
    CHECK ("payment_method" <> 'prepaid' OR "payment_id" IS NOT NULL);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_currency_inr" CHECK ("currency" = 'INR');

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_gst_split_known" CHECK ("gst_split" IN ('intra_state', 'inter_state'));

-- The snapshot's own arithmetic: GST is included in the subtotal, and the
-- total is subtotal + shipping + COD fee (`src/server/pricing/`).
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
    CHECK ("subtotal_paise" >= 0 AND "tax_paise" >= 0 AND "shipping_paise" >= 0 AND "cod_fee_paise" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_adds_up"
    CHECK ("total_paise" > 0 AND "total_paise" = "subtotal_paise" + "shipping_paise" + "cod_fee_paise");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_line_adds_up"
    CHECK ("unit_price_paise" >= 0 AND "line_subtotal_paise" = "unit_price_paise" * "quantity");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_tax_split_adds_up"
    CHECK ("cgst_paise" >= 0 AND "sgst_paise" >= 0 AND "igst_paise" >= 0
           AND "line_tax_paise" = "cgst_paise" + "sgst_paise" + "igst_paise");

-- Row Level Security, same convention as every prior migration — access is
-- via Prisma using a role that owns these tables and bypasses RLS. No
-- policies defined.
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_status_history" ENABLE ROW LEVEL SECURITY;
