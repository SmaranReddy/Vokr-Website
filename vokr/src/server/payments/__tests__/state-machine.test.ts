import { describe, expect, it } from "vitest";

import { PaymentStatus } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

import {
  assertValidPaymentTransition,
  isValidPaymentTransition,
  nextPaymentStatus,
} from "../state-machine";

const ALL = Object.values(PaymentStatus);

const LEGAL: ReadonlyArray<[PaymentStatus, PaymentStatus]> = [
  ["created", "authorized"],
  ["created", "captured"],
  ["created", "failed"],
  ["authorized", "captured"],
  ["authorized", "failed"],
  ["failed", "authorized"],
  ["failed", "captured"],
  ["captured", "refunded"],
];

const ILLEGAL = ALL.flatMap((from) =>
  ALL.map((to) => [from, to] as [PaymentStatus, PaymentStatus]),
).filter(([from, to]) => !LEGAL.some(([f, t]) => f === from && t === to));

describe("payment state machine (plan §5 Phase 7, task 8)", () => {
  it.each(LEGAL)("allows %s -> %s", (from, to) => {
    expect(isValidPaymentTransition(from, to)).toBe(true);
  });

  it.each(ILLEGAL)("rejects %s -> %s", (from, to) => {
    expect(isValidPaymentTransition(from, to)).toBe(false);
    expect(() => assertValidPaymentTransition("p1", from, to)).toThrow(ConflictError);
  });

  it("never moves backwards out of captured or refunded", () => {
    for (const to of ALL) {
      if (to !== "refunded") expect(nextPaymentStatus("captured", to)).toBeNull();
      expect(nextPaymentStatus("refunded", to)).toBeNull();
    }
  });

  it("treats a stale authorized after captured as a no-op (out-of-order delivery)", () => {
    expect(nextPaymentStatus("captured", "authorized")).toBeNull();
  });

  it("lets a second attempt capture after the first failed", () => {
    expect(nextPaymentStatus("failed", "captured")).toBe("captured");
  });

  it("a repeated event is a no-op", () => {
    for (const status of ALL) expect(nextPaymentStatus(status, status)).toBeNull();
  });
});
