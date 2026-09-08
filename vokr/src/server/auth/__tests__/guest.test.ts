import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/server/db/client", () => ({
  prisma: {
    guestSession: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

// Imported after the mock so the module under test picks up the mocked client.
const { GUEST_COOKIE_NAME, clearGuestCookie, getOrCreateGuestSession } =
  await import("../guest");
const { hashGuestToken } = await import("../tokens");

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  createMock.mockReset();
});

describe("getOrCreateGuestSession", () => {
  it("creates a session and issues a cookie when no token is presented", async () => {
    createMock.mockResolvedValue({ id: "new-id" });

    const result = await getOrCreateGuestSession(undefined);

    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledOnce();
    expect(result.guestSessionId).toBe("new-id");
    expect(result.setCookie).toMatchObject({
      name: GUEST_COOKIE_NAME,
      options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    });
    expect(result.setCookie?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses a live session, bumps last_seen_at, and does not mint a new cookie", async () => {
    findUniqueMock.mockResolvedValue({
      id: "existing-id",
      expiresAt: new Date(Date.now() + 1000),
    });
    updateMock.mockResolvedValue({ id: "existing-id" });

    const result = await getOrCreateGuestSession("a".repeat(64));

    expect(result.guestSessionId).toBe("existing-id");
    expect(result.setCookie).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledOnce();
  });

  it("mints a new session when the presented token is unknown", async () => {
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "new-id" });

    const result = await getOrCreateGuestSession("a".repeat(64));

    expect(result.guestSessionId).toBe("new-id");
    expect(result.setCookie).toBeDefined();
  });

  it("mints a new session when the found row has expired", async () => {
    findUniqueMock.mockResolvedValue({
      id: "expired-id",
      expiresAt: new Date(Date.now() - 1000),
    });
    createMock.mockResolvedValue({ id: "new-id" });

    const result = await getOrCreateGuestSession("a".repeat(64));

    expect(result.guestSessionId).toBe("new-id");
    expect(result.setCookie).toBeDefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("looks the token up by its hash, never by the raw value", async () => {
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "new-id" });

    const rawToken = "b".repeat(64);
    await getOrCreateGuestSession(rawToken);

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { tokenHash: hashGuestToken(rawToken) },
      select: { id: true, expiresAt: true },
    });
  });
});

describe("clearGuestCookie", () => {
  it("expires the cookie immediately with an empty value", () => {
    const cookie = clearGuestCookie();
    expect(cookie).toMatchObject({
      name: GUEST_COOKIE_NAME,
      value: "",
      options: { maxAge: 0 },
    });
  });
});
