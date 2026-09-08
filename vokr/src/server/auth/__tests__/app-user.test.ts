import { describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();

vi.mock("@/server/db/client", () => ({
  prisma: {
    appUser: {
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

const { getOrCreateAppUser } = await import("../app-user");

describe("getOrCreateAppUser", () => {
  it("upserts on the primary key with an empty update — never mutates email on an existing row", async () => {
    upsertMock.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      createdAt: new Date(),
    });

    await getOrCreateAppUser({ id: "user-1", email: "a@example.com" });

    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      create: { id: "user-1", email: "a@example.com" },
      update: {},
      select: { id: true, email: true, createdAt: true },
    });
  });
});
