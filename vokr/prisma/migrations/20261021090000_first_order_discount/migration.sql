-- First-order discount (owner decisions, 21 Oct 2026): 10% off the products
-- of a new customer's first order, keyed by phone, email and name + address. Additive only: two defaulted columns,
-- one new table, and the order-total CHECK widened to subtract the discount.

ALTER TABLE "orders" ADD COLUMN "discount_paise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discount_kind" TEXT;

ALTER TABLE "order_items" ADD COLUMN "line_discount_paise" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "first_order_discount_claims" (
    "key_kind" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "first_order_discount_claims_pkey" PRIMARY KEY ("key_kind","key_hash")
);

CREATE INDEX "first_order_discount_claims_order_id_idx" ON "first_order_discount_claims"("order_id");

ALTER TABLE "first_order_discount_claims" ADD CONSTRAINT "first_order_discount_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECKs (Prisma's schema language has none), same convention
-- as 20261015145320_orders.
ALTER TABLE "orders" DROP CONSTRAINT "orders_total_adds_up";
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_adds_up"
    CHECK ("total_paise" > 0
           AND "total_paise" = "subtotal_paise" - "discount_paise" + "shipping_paise" + "cod_fee_paise");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_discount_valid"
    CHECK ("discount_paise" >= 0 AND "discount_paise" <= "subtotal_paise"
           AND ("discount_paise" = 0) = ("discount_kind" IS NULL)
           AND ("discount_kind" IS NULL OR "discount_kind" = 'first_order'));

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_discount_valid"
    CHECK ("line_discount_paise" >= 0 AND "line_discount_paise" <= "line_subtotal_paise");

ALTER TABLE "first_order_discount_claims"
  ADD CONSTRAINT "first_order_discount_claims_key_valid"
    CHECK ("key_kind" IN ('phone', 'email', 'name_address') AND "key_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "first_order_discount_claims" ENABLE ROW LEVEL SECURITY;
