import { describe, expect, it } from "vitest";

import { ReturnKind, ReturnState } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

import { assertWithinReturnWindow, claimedUnits, lineRefundPaise, RETURN_WINDOW_DAYS, wholeOrderReturn } from "../policy";

const DAY = 24 * 60 * 60 * 1000;

describe("assertWithinReturnWindow", () => {
  const delivered = new Date("2026-10-01T10:00:00Z");
  it("allows the whole 30 days from delivery and nothing after", () => {
    expect(RETURN_WINDOW_DAYS).toBe(30);
    expect(() => assertWithinReturnWindow(delivered, new Date(delivered.getTime() + 30 * DAY))).not.toThrow();
    expect(() => assertWithinReturnWindow(delivered, new Date(delivered.getTime() + 30 * DAY + 1))).toThrow(ConflictError);
  });
  it("refuses an order with no delivery", () => {
    expect(() => assertWithinReturnWindow(null, new Date())).toThrow("once an order is delivered");
  });
});

describe("claimedUnits", () => {
  it("counts returns and exchanges that are not rejected; RTO rows are not claims", () => {
    expect(
      claimedUnits([
        { kind: ReturnKind.return, state: ReturnState.completed, quantity: 1 },
        { kind: ReturnKind.exchange, state: ReturnState.requested, quantity: 2 },
        { kind: ReturnKind.return, state: ReturnState.rejected, quantity: 5 },
        { kind: ReturnKind.rto, state: ReturnState.completed, quantity: 3 },
      ]),
    ).toBe(3);
  });
});

describe("lineRefundPaise", () => {
  it("is the GST-inclusive unit price times the units returned", () => {
    expect(lineRefundPaise({ unitPricePaise: 999_500 }, 2)).toBe(1_999_000);
  });
});

describe("wholeOrderReturn", () => {
  const items = [
    { id: "a", quantity: 1 },
    { id: "b", quantity: 2 },
  ];
  const back = (orderItemId: string, quantity: number, extra: Partial<{ state: ReturnState; qcPassed: boolean | null; refundMode: string | null; kind: ReturnKind }> = {}) => ({
    id: `${orderItemId}-${quantity}`,
    orderItemId,
    quantity,
    kind: ReturnKind.return,
    state: ReturnState.received,
    qcPassed: true,
    refundMode: null,
    ...extra,
  });
  const order = { shippingPaise: 0, codFeePaise: 0, items };

  it("settles when every unit of every line is back and checked", () => {
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 2)])).toHaveLength(2);
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 1), back("b", 1)])).toHaveLength(3);
  });
  it("does not settle a partial return, a failed check, an exchange, or anything already refunded", () => {
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 1)])).toBeNull();
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 2, { qcPassed: false })])).toBeNull();
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 2, { kind: ReturnKind.exchange })])).toBeNull();
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 2, { state: ReturnState.approved })])).toBeNull();
    expect(wholeOrderReturn(order, [back("a", 1), back("b", 2), back("b", 0, { refundMode: "manual_due" })])).toBeNull();
  });
  it("never settles an order that charged shipping or a COD fee (no published policy for refunding them)", () => {
    expect(wholeOrderReturn({ ...order, shippingPaise: 1 }, [back("a", 1), back("b", 2)])).toBeNull();
    expect(wholeOrderReturn({ ...order, codFeePaise: 1 }, [back("a", 1), back("b", 2)])).toBeNull();
  });
});
