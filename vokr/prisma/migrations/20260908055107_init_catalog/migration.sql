-- CreateEnum
CREATE TYPE "catalog_status" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "hsn_code" TEXT,
    "gst_rate_bps" INTEGER,
    "status" "catalog_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "size_label" TEXT NOT NULL,
    "colorway" TEXT NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'draft',

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "variant_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("variant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_status_idx" ON "product_variants"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_colorway_size_label_key" ON "product_variants"("product_id", "colorway", "size_label");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Hand-written additions below this line. Prisma's schema language has
-- no CHECK-constraint or cross-table-trigger primitive, so these are
-- added directly to the generated migration rather than expressed in
-- schema.prisma. See Vokr-Implementation-Plan.md §3.5 and §5 Phase 2.
-- ---------------------------------------------------------------------

-- Inventory backstop (R9). Application logic alone is not sufficient —
-- these are the last line of defense against overselling and against a
-- negative reservation ever being persisted, independent of any bug in
-- the Phase 8 reservation transaction that will read this table under
-- `SELECT ... FOR UPDATE`.
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_on_hand_non_negative"
    CHECK ("quantity_on_hand" >= 0),
  ADD CONSTRAINT "inventory_quantity_reserved_non_negative"
    CHECK ("quantity_reserved" >= 0),
  ADD CONSTRAINT "inventory_reserved_not_exceeding_on_hand"
    CHECK ("quantity_on_hand" - "quantity_reserved" >= 0);

-- Decision D2 (GST rate + HSN per SKU) is still open. Rather than invent
-- a rate, `products.gst_rate_bps` stays nullable and this trigger refuses
-- to let any variant reach "active" status while its product has none —
-- an unanswered D2 fails loudly at write time instead of silently
-- mis-charging tax later. A plain CHECK constraint cannot express this
-- because it spans two tables.
CREATE FUNCTION "enforce_variant_gst_rate"() RETURNS TRIGGER AS $$
DECLARE
  product_gst_rate_bps INTEGER;
BEGIN
  IF NEW."status" = 'active' THEN
    SELECT "gst_rate_bps" INTO product_gst_rate_bps
      FROM "products" WHERE "id" = NEW."product_id";

    IF product_gst_rate_bps IS NULL THEN
      RAISE EXCEPTION
        'product_variants: cannot set variant % to active — its product (%) has no gst_rate_bps yet (decision D2 unresolved, Vokr-Implementation-Plan.md §0.3)',
        NEW."id", NEW."product_id";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "product_variants_require_gst_rate"
  BEFORE INSERT OR UPDATE ON "product_variants"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_variant_gst_rate"();

-- Row Level Security, enabled from the first migration on every table —
-- even though launch access is via Prisma using a role that owns these
-- tables (and therefore bypasses RLS by default). RLS-off is a footgun
-- that is invisible until something other than that owner role connects
-- (e.g. a future Supabase anon/authenticated key). No policies are
-- defined yet because nothing besides the owning role is expected to
-- query these tables at this phase.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;
