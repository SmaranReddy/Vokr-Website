import { config as loadEnv } from "dotenv";
import path from "node:path";

// Prisma v7 does not auto-load .env files (see AGENTS.md / Prisma
// `prisma-upgrade-v7` skill, `env-variables.md`). This project's single
// local-dev secrets file is `.env.local` (see `.env.example`), not `.env`
// — load that explicitly so the CLI and the Next.js app read the same
// values instead of maintaining two copies.
loadEnv({ path: path.resolve(import.meta.dirname, ".env.local"), quiet: true });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Prisma 7's config schema dropped the v6 `directUrl` datasource
    // field entirely (confirmed against the installed
    // @prisma/config@7.10.0 types — `Datasource` only has `url` and
    // `shadowDatabaseUrl`). The dual pooled/direct connection strategy
    // the Phase 8 checkout transaction needs
    // (Vokr-Implementation-Plan.md §3.1, ADR-004) is an
    // application-level concern instead — a second driver-adapter
    // instance built from `DIRECT_URL`, not a config-file setting.
    //
    // `shadowDatabaseUrl` is the one place a direct/session connection
    // is still a *migration-engine* concern: `migrate dev`'s shadow-db
    // creation needs a session connection, not a transaction-mode
    // pooler. Only set it when DIRECT_URL genuinely differs from
    // DATABASE_URL — locally both point at the same Compose Postgres
    // (see .env.local), where Prisma auto-manages an ephemeral shadow
    // database instead; pointing shadowDatabaseUrl at an identical URL
    // is a hard error ("shadow database ... same as the main
    // database"). Against a real pooled Supabase connection the two
    // differ, and this then does the right thing automatically.
    ...(process.env["DIRECT_URL"] &&
    process.env["DIRECT_URL"] !== process.env["DATABASE_URL"]
      ? { shadowDatabaseUrl: env("DIRECT_URL") }
      : {}),
  },
});
