-- CreateEnum
CREATE TYPE "return_kind" AS ENUM ('return', 'exchange', 'rto');

-- CreateEnum
CREATE TYPE "return_state" AS ENUM ('requested', 'approved', 'rejected', 'received', 'completed');

-- CreateEnum
CREATE TYPE "return_reason" AS ENUM ('size_fit', 'defective', 'not_as_described', 'changed_mind', 'other', 'undelivered');

-- CreateEnum
CREATE TYPE "return_refund_mode" AS ENUM ('full_order_queued', 'manual_due');

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "kind" "return_kind" NOT NULL,
    "state" "return_state" NOT NULL DEFAULT 'requested',
    "reason" "return_reason" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "requested_variant_id" UUID,
    "requested_by" TEXT NOT NULL,
    "qc_passed" BOOLEAN,
    "restocked_at" TIMESTAMPTZ(6),
    "refund_mode" "return_refund_mode",
    "refund_due_paise" INTEGER,
    "refund_reference" TEXT,
    "replacement_courier" TEXT,
    "replacement_awb" TEXT,
    "replacement_dispatched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_requests_order_id_created_at_idx" ON "return_requests"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "return_requests_order_item_id_idx" ON "return_requests"("order_item_id");

-- CreateIndex
CREATE INDEX "return_requests_state_created_at_idx" ON "return_requests"("state", "created_at");

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_requested_variant_id_fkey" FOREIGN KEY ("requested_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma has no CHECK/partial-index/trigger primitives).

ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_quantity_positive" CHECK ("quantity" > 0);

-- An exchange names its replacement; nothing else does.
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_exchange_variant" CHECK (
  ("kind" = 'exchange') = ("requested_variant_id" IS NOT NULL)
);

-- RTO rows are failed deliveries, recorded on receipt.
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_rto_shape" CHECK (
  "kind" <> 'rto' OR ("reason" = 'undelivered' AND "state" = 'completed')
);
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_undelivered_is_rto" CHECK (
  "reason" <> 'undelivered' OR "kind" = 'rto'
);

-- Stock comes back only from a passed quality check.
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_restock_needs_qc" CHECK (
  "restocked_at" IS NULL OR "qc_passed" IS TRUE
);

-- Refunds belong to returns, and mode and amount go together.
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_refund_shape" CHECK (
  ("refund_mode" IS NULL) = ("refund_due_paise" IS NULL)
  AND ("refund_mode" IS NULL OR ("kind" = 'return' AND "qc_passed" IS TRUE))
  AND ("refund_due_paise" IS NULL OR "refund_due_paise" >= 0)
  AND ("refund_reference" IS NULL OR "refund_mode" = 'manual_due')
);

-- A replacement ships only for an exchange; courier, AWB and time together.
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_replacement_shape" CHECK (
  ("replacement_awb" IS NULL) = ("replacement_courier" IS NULL)
  AND ("replacement_awb" IS NULL) = ("replacement_dispatched_at" IS NULL)
  AND ("replacement_awb" IS NULL OR ("kind" = 'exchange' AND "qc_passed" IS TRUE))
  AND ("replacement_courier" IS NULL OR char_length("replacement_courier") BETWEEN 1 AND 60)
  AND ("replacement_awb" IS NULL OR char_length("replacement_awb") BETWEEN 4 AND 40)
);

-- One open customer request per order item; one RTO record per order item.
CREATE UNIQUE INDEX "return_requests_one_open_per_item" ON "return_requests"("order_item_id")
  WHERE "kind" <> 'rto' AND "state" IN ('requested', 'approved', 'received');
CREATE UNIQUE INDEX "return_requests_one_rto_per_item" ON "return_requests"("order_item_id")
  WHERE "kind" = 'rto';

-- Backstop for the application's check under the order lock: the units
-- returned or exchanged from an item (rows not rejected) never exceed the
-- units bought. Locks the order item row, so concurrent inserts serialise.
CREATE FUNCTION "return_requests_check_quantity"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bought integer;
  claimed integer;
BEGIN
  IF NEW."kind" = 'rto' OR NEW."state" = 'rejected' THEN
    RETURN NEW;
  END IF;
  SELECT "quantity" INTO bought FROM "order_items" WHERE "id" = NEW."order_item_id" FOR UPDATE;
  SELECT COALESCE(SUM("quantity"), 0) INTO claimed FROM "return_requests"
   WHERE "order_item_id" = NEW."order_item_id" AND "kind" <> 'rto' AND "state" <> 'rejected' AND "id" <> NEW."id";
  IF claimed + NEW."quantity" > bought THEN
    RAISE EXCEPTION 'return_requests: % unit(s) of order item % already claimed, % bought', claimed, NEW."order_item_id", bought
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "return_requests_quantity_guard" BEFORE INSERT OR UPDATE OF "quantity", "state", "kind" ON "return_requests"
  FOR EACH ROW EXECUTE FUNCTION "return_requests_check_quantity"();

-- Same convention as every prior table: RLS on, no policies — only the
-- server's direct connection reads or writes it, never the anon API.
ALTER TABLE "return_requests" ENABLE ROW LEVEL SECURITY;
