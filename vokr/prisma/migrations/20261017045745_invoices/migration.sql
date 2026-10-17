-- CreateTable
CREATE TABLE "invoice_counters" (
    "financial_year" TEXT NOT NULL,
    "last_serial" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("financial_year")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "seller" JSONB NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_financial_year_serial_key" ON "invoices"("financial_year", "serial");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma has no CHECK/trigger primitives).

-- CGST Rules r.46(b): a consecutive serial number of at most 16
-- characters, unique for the financial year. Format pending CA review.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format" CHECK (
  char_length("invoice_number") <= 16 AND "serial" > 0
  AND "financial_year" ~ '^[0-9]{4}-[0-9]{2}$'
);
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_valid" CHECK (
  "last_serial" >= 0 AND "financial_year" ~ '^[0-9]{4}-[0-9]{2}$'
);

-- An issued invoice is never edited (8-year retention; a correction is a
-- credit note, not an update).
CREATE FUNCTION "invoices_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoices are immutable';
END;
$$;
CREATE TRIGGER "invoices_no_update" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_refuse_update"();

-- Same convention as every prior table: RLS on, no policies.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
