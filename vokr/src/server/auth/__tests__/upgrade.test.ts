import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetGuestUpgradeHandlersForTests,
  registerGuestUpgradeHandler,
  runGuestUpgradeHandlers,
  type TransactionClient,
} from "@/server/auth/upgrade";

const fakeTx = {} as TransactionClient;

beforeEach(() => {
  __resetGuestUpgradeHandlersForTests();
});

describe("guest upgrade handler registry", () => {
  it("runs registered handlers in registration order with the given context", async () => {
    const calls: string[] = [];
    registerGuestUpgradeHandler(async (ctx) => {
      calls.push(`first:${ctx.guestSessionId}:${ctx.userId}`);
    });
    registerGuestUpgradeHandler(async (ctx) => {
      calls.push(`second:${ctx.guestSessionId}:${ctx.userId}`);
    });

    await runGuestUpgradeHandlers({
      guestSessionId: "g1",
      userId: "u1",
      tx: fakeTx,
    });

    expect(calls).toEqual(["first:g1:u1", "second:g1:u1"]);
  });

  it("resolves without error when no handlers are registered", async () => {
    await expect(
      runGuestUpgradeHandlers({
        guestSessionId: "g1",
        userId: "u1",
        tx: fakeTx,
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates a handler's rejection rather than swallowing it", async () => {
    registerGuestUpgradeHandler(async () => {
      throw new Error("merge failed");
    });

    await expect(
      runGuestUpgradeHandlers({
        guestSessionId: "g1",
        userId: "u1",
        tx: fakeTx,
      }),
    ).rejects.toThrow("merge failed");
  });
});
