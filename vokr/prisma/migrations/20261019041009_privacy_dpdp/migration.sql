-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('account_terms', 'marketing_email');

-- CreateEnum
CREATE TYPE "consent_action" AS ENUM ('granted', 'withdrawn');

-- CreateEnum
CREATE TYPE "data_subject_request_kind" AS ENUM ('erasure');

-- CreateEnum
CREATE TYPE "data_subject_request_state" AS ENUM ('requested', 'approved', 'rejected', 'completed');

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "subject_hash" TEXT NOT NULL,
    "purpose" "consent_purpose" NOT NULL,
    "action" "consent_action" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "data_subject_request_kind" NOT NULL,
    "state" "data_subject_request_state" NOT NULL DEFAULT 'requested',
    "decided_by" TEXT,
    "decision_reason" TEXT,
    "report" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_subject_hash_purpose_created_at_idx" ON "consent_records"("subject_hash", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_user_id_created_at_idx" ON "consent_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_state_created_at_idx" ON "data_subject_requests"("state", "created_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_user_id_idx" ON "data_subject_requests"("user_id");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma has no CHECK/partial-index/trigger primitives).

ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_subject_hash_shape" CHECK ("subject_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_ip_hash_shape" CHECK ("ip_hash" IS NULL OR "ip_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_source_shape" CHECK ("source" ~ '^[a-z_]{1,40}$');
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_policy_version_shape" CHECK (char_length("policy_version") BETWEEN 1 AND 40);

-- Append-only: consent history must be provable (plan §5 Phase 17, task 1).
-- UPDATE is always refused. DELETE is refused unless the transaction has
-- set vokr.consent_retention_purge = 'on' — reserved for the retention
-- rule ("life of the account + 1 year", §3.5), which is not built yet.
CREATE FUNCTION "consent_records_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vokr.consent_retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent_records is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "consent_records_no_update" BEFORE UPDATE OR DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION "consent_records_append_only"();

-- At most one open erasure request per account; a decision is made once.
CREATE UNIQUE INDEX "data_subject_requests_one_open_per_user" ON "data_subject_requests"("user_id", "kind")
  WHERE "state" IN ('requested', 'approved');
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_decision_shape" CHECK (
  ("state" = 'requested') = ("decided_at" IS NULL)
  AND ("decided_at" IS NULL) = ("decided_by" IS NULL)
  AND ("state" = 'completed') = ("completed_at" IS NOT NULL)
);

-- Same convention as every prior table: RLS on, no policies — only the
-- server's direct connection reads or writes them, never the anon API.
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;
