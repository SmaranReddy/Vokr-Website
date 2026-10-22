import { describe, expect, it } from "vitest";

import { formatPaiseAsRupees } from "../currency";

describe("formatPaiseAsRupees", () => {
  it("shows whole rupees as the legacy site did", () => {
    expect(formatPaiseAsRupees(699_900)).toBe("₹6,999");
    expect(formatPaiseAsRupees(0)).toBe("₹0");
  });

  it("shows paise when there are any (the unrounded first-order discount)", () => {
    expect(formatPaiseAsRupees(69_990)).toBe("₹699.90");
    expect(formatPaiseAsRupees(629_910)).toBe("₹6,299.10");
  });
});
