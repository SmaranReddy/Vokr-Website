import { describe, expect, it, vi } from "vitest";

import { OrderStatus } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

import { assertValidOrderTransition, isValidOrderTransition, TRACKER_STEPS } from "../state-machine";

describe("order status machine (plan §5 Phase 9, task 5)", () => {
  it.each([
    ["confirmed", "preparing"],
    ["preparing", "shipped"],
    ["shipped", "delivered"],
    ["delivered", "returned"],
    ["confirmed", "cancelled"],
    ["preparing", "cancelled"],
    ["shipped", "rto"],
    ["confirmed", "refunded"],
    ["delivered", "refunded"],
    ["returned", "refunded"],
    ["rto", "refunded"],
    ["cancelled", "refunded"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(isValidOrderTransition(from, to)).toBe(true);
  });

  it.each([
    ["preparing", "confirmed"],
    ["shipped", "preparing"],
    ["delivered", "shipped"],
    ["shipped", "cancelled"],
    ["delivered", "cancelled"],
    ["confirmed", "delivered"],
    ["confirmed", "shipped"],
    ["refunded", "confirmed"],
    ["refunded", "delivered"],
    ["cancelled", "confirmed"],
    ["returned", "delivered"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(isValidOrderTransition(from, to)).toBe(false);
  });

  it("refunded is terminal", () => {
    for (const to of Object.values(OrderStatus)) {
      expect(isValidOrderTransition(OrderStatus.refunded, to)).toBe(false);
    }
  });

  it("an illegal transition throws a 409 and is logged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => assertValidOrderTransition("o1", OrderStatus.delivered, OrderStatus.confirmed)).toThrow(ConflictError);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("the tracker draws the legacy UI's four steps in order", () => {
    expect(TRACKER_STEPS).toEqual(["confirmed", "preparing", "shipped", "delivered"]);
  });
});
