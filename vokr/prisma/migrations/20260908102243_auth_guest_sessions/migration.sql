-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "phone_enc" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_token_hash_key" ON "guest_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "guest_sessions_expires_at_idx" ON "guest_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "rate_limit_counters_window_start_idx" ON "rate_limit_counters"("window_start");

-- ---------------------------------------------------------------------
-- Hand-written additions below this line, same convention as the first
-- migration (Vokr-Implementation-Plan.md §5 Phase 2): Prisma's schema
-- language has no CHECK-constraint primitive.
-- ---------------------------------------------------------------------

-- Backstop constraints. `count` only ever increments inside
-- `consumeRateLimit()`'s single-statement upsert, and `expires_at` is
-- always `created_at + 90 days` at insert time — but a CHECK is a
-- database guarantee, not an application hope (AGENTS.md "Database").
ALTER TABLE "rate_limit_counters"
  ADD CONSTRAINT "rate_limit_counters_count_non_negative"
    CHECK ("count" >= 0);

ALTER TABLE "guest_sessions"
  ADD CONSTRAINT "guest_sessions_expires_after_created"
    CHECK ("expires_at" > "created_at");

-- Row Level Security, enabled from creation on every table — see the
-- first migration's identical note. Launch access is via Prisma using a
-- role that owns these tables and therefore bypasses RLS by default; this
-- guards against a future connection (e.g. a Supabase anon/authenticated
-- key) reaching these tables with no policy in place. No policies are
-- defined yet — nothing besides the owning role queries these tables at
-- this phase.
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guest_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_counters" ENABLE ROW LEVEL SECURITY;
