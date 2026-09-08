import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getOrCreateAppUser } from "@/server/auth/app-user";
import { prisma } from "@/server/db/client";

/**
 * Requires a running Postgres with migrations applied — see README.md.
 * Run via `npm run test:integration`.
 *
 * Cleanup is scoped to the exact ids this file creates, not a table-wide
 * `deleteMany({})` — `complete-sign-in`'s integration suite touches this
 * same `app_users` table and runs concurrently with this file.
 */

const createdIds: string[] = [];

function newTrackedId(): string {
  const id = randomUUID();
  createdIds.push(id);
  return id;
}

afterEach(async () => {
  await prisma.appUser.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getOrCreateAppUser (Phase 3, task 8)", () => {
  it("creates a row on first call", async () => {
    const id = newTrackedId();
    const user = await getOrCreateAppUser({ id, email: `${id}@example.com` });
    expect(user.id).toBe(id);

    await expect(
      prisma.appUser.findUniqueOrThrow({ where: { id } }),
    ).resolves.toMatchObject({ email: `${id}@example.com` });
  });

  it("is idempotent under concurrent duplicate calls — exactly one row results", async () => {
    const id = newTrackedId();
    const email = `${id}@example.com`;

    await Promise.all(
      Array.from({ length: 10 }, () => getOrCreateAppUser({ id, email })),
    );

    await expect(prisma.appUser.count({ where: { id } })).resolves.toBe(1);
  });

  it("never mutates email on an existing row", async () => {
    const id = newTrackedId();
    await getOrCreateAppUser({ id, email: "first@example.com" });
    await getOrCreateAppUser({ id, email: "second@example.com" });

    const row = await prisma.appUser.findUniqueOrThrow({ where: { id } });
    expect(row.email).toBe("first@example.com");
  });

  it("rejects a duplicate email across two different ids (UNIQUE constraint)", async () => {
    const email = `${randomUUID()}@example.com`;
    await getOrCreateAppUser({ id: newTrackedId(), email });

    await expect(
      prisma.appUser.create({ data: { id: newTrackedId(), email } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("has Row Level Security enabled", async () => {
    const rows = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'app_users'
    `;
    expect(rows[0]?.relrowsecurity).toBe(true);
  });
});
