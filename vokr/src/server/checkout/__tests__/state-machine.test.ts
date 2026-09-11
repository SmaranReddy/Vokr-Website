import { describe, expect, it } from "vitest";

import { CheckoutState } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

import {
  assertValidCheckoutTransition,
  isValidCheckoutTransition,
} from "../state-machine";

describe("checkout state machine (plan §5 Phase 6, task 8)", () => {
  it("allows every step of the documented chain", () => {
    const chain: CheckoutState[] = [
      CheckoutState.draft,
      CheckoutState.address_captured,
      CheckoutState.priced,
      CheckoutState.reserved,
      CheckoutState.payment_pending,
      CheckoutState.paid,
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(isValidCheckoutTransition(chain[i]!, chain[i + 1]!)).toBe(true);
    }
  });

  it("allows payment_pending to fail instead of succeed", () => {
    expect(
      isValidCheckoutTransition(CheckoutState.payment_pending, CheckoutState.failed),
    ).toBe(true);
  });

  it("allows abandonment or expiry from every non-terminal state", () => {
    const nonTerminal: CheckoutState[] = [
      CheckoutState.draft,
      CheckoutState.address_captured,
      CheckoutState.priced,
    ];
    for (const from of nonTerminal) {
      expect(isValidCheckoutTransition(from, CheckoutState.abandoned)).toBe(true);
      expect(isValidCheckoutTransition(from, CheckoutState.expired)).toBe(true);
    }
    expect(isValidCheckoutTransition(CheckoutState.reserved, CheckoutState.expired)).toBe(true);
    expect(
      isValidCheckoutTransition(CheckoutState.payment_pending, CheckoutState.expired),
    ).toBe(true);
  });

  it("rejects skipping a state", () => {
    expect(isValidCheckoutTransition(CheckoutState.draft, CheckoutState.priced)).toBe(false);
    expect(
      isValidCheckoutTransition(CheckoutState.draft, CheckoutState.reserved),
    ).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(
      isValidCheckoutTransition(CheckoutState.priced, CheckoutState.address_captured),
    ).toBe(false);
    expect(
      isValidCheckoutTransition(CheckoutState.reserved, CheckoutState.priced),
    ).toBe(false);
  });

  it("terminal states (paid, failed, expired, abandoned) accept no further transition", () => {
    for (const terminal of [
      CheckoutState.paid,
      CheckoutState.failed,
      CheckoutState.expired,
      CheckoutState.abandoned,
    ]) {
      for (const to of Object.values(CheckoutState)) {
        expect(isValidCheckoutTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("assertValidCheckoutTransition throws ConflictError for an illegal transition and passes silently for a legal one", () => {
    expect(() =>
      assertValidCheckoutTransition("session-1", CheckoutState.draft, CheckoutState.reserved),
    ).toThrow(ConflictError);
    expect(() =>
      assertValidCheckoutTransition(
        "session-1",
        CheckoutState.draft,
        CheckoutState.address_captured,
      ),
    ).not.toThrow();
  });
});
