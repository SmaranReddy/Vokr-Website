-- AlterEnum
ALTER TYPE "email_template" ADD VALUE 'order_shipped';

-- AlterTable
ALTER TABLE "app_users" ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "awb" TEXT,
ADD COLUMN     "courier" TEXT,
ADD COLUMN     "shipped_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_created_at_idx" ON "audit_log"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- Hand-written (Prisma has no CHECK/trigger primitives).

-- Courier, AWB and shipped_at are written together when an order ships
-- (plan §5 Phase 10, task 3): all three or none.
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipment_all_or_none" CHECK (
  ("courier" IS NULL) = ("awb" IS NULL) AND ("awb" IS NULL) = ("shipped_at" IS NULL)
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipment_lengths" CHECK (
  ("courier" IS NULL OR char_length("courier") BETWEEN 1 AND 60)
  AND ("awb" IS NULL OR char_length("awb") BETWEEN 4 AND 40)
);

-- Append-only: an audit row is never edited. (DELETE stays possible for
-- the Phase 17 retention prune.)
CREATE FUNCTION "audit_log_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
CREATE TRIGGER "audit_log_no_update" BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_refuse_update"();

-- Same convention as every prior table: RLS on, no policies — only the
-- server's direct connection reads or writes it, never the anon API.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
