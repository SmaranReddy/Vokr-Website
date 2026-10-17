-- CreateTable
CREATE TABLE "invoice_counters" (
    "series" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "last_serial" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("series","financial_year")
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

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "seller" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_financial_year_serial_key" ON "invoices"("financial_year", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_order_id_key" ON "credit_notes"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_invoice_id_key" ON "credit_notes"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_credit_note_number_key" ON "credit_notes"("credit_note_number");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_financial_year_serial_key" ON "credit_notes"("financial_year", "serial");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma has no CHECK/trigger primitives).

-- CGST Rules r.46(b) / r.53: consecutive serials of at most 16
-- characters, unique per financial year. Format pending CA review.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format" CHECK (
  char_length("invoice_number") <= 16 AND "serial" > 0
  AND "financial_year" ~ '^[0-9]{4}-[0-9]{2}$'
);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_number_format" CHECK (
  char_length("credit_note_number") <= 16 AND "serial" > 0
  AND "financial_year" ~ '^[0-9]{4}-[0-9]{2}$'
);
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_valid" CHECK (
  "series" IN ('invoice', 'credit_note') AND "last_serial" >= 0
  AND "financial_year" ~ '^[0-9]{4}-[0-9]{2}$'
);

-- Issued tax documents are never edited (8-year retention).
CREATE FUNCTION "tax_document_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "invoices_no_update" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "tax_document_refuse_update"();
CREATE TRIGGER "credit_notes_no_update" BEFORE UPDATE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION "tax_document_refuse_update"();

-- Same convention as every prior table: RLS on, no policies.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
