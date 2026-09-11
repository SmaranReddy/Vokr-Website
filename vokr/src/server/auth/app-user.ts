import { prisma } from "@/server/db/client";

export interface AppUserUpsertInput {
  /** Must be a Supabase `auth.users.id` from a verified session — never client input. */
  id: string;
  email: string;
}

export interface AppUserRecord {
  id: string;
  email: string;
  createdAt: Date;
}

/**
 * Idempotent — creates the `app_users` row on first authenticated request
 * if it does not already exist, so a Supabase user without a profile is
 * impossible (plan §5 Phase 3, task 8). `upsert` on the primary key is one
 * atomic statement, not a read-then-write, so concurrent duplicate calls
 * for the same id (e.g. two tabs completing sign-in at once) create
 * exactly one row.
 *
 * Never mutates `email` on an existing row — an email change is a
 * deliberate, confirmed flow (task 9), not a passive sync on every
 * request.
 */
export async function getOrCreateAppUser({
  id,
  email,
}: AppUserUpsertInput): Promise<AppUserRecord> {
  return prisma.appUser.upsert({
    where: { id },
    create: { id, email },
    update: {},
    select: { id: true, email: true, createdAt: true },
  });
}
