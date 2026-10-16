import { describe, expect, it, vi } from "vitest";

// Pure helpers only; the modules they live in also import the database client.
vi.mock("@/server/db/client", () => ({ prisma: {} }));

import { OrderStatus } from "@/generated/prisma/enums";

import { sessionAuthTime } from "../guard";
import { adminNextStatuses } from "../orders";
import { ADMIN_PATH } from "../paths";
import { csvCell, splitName, tenDigitMobile } from "../shiprocket-csv";

describe("ADMIN_PATH", () => {
  it.each(["/admin", "/admin/", "/admin/orders", "/api/admin", "/api/admin/orders/VK-1/refund"])("gates %s", (path) => {
    expect(ADMIN_PATH.test(path)).toBe(true);
  });
  it.each(["/administrator", "/api/administer", "/shop/admin", "/api/orders", "/", "/adminx/y"])("leaves %s alone", (path) => {
    expect(ADMIN_PATH.test(path)).toBe(false);
  });
});

describe("sessionAuthTime", () => {
  it("takes the latest amr timestamp", () => {
    expect(sessionAuthTime([{ method: "password", timestamp: 10 }, { method: "otp", timestamp: 30 }], undefined)).toBe(30);
  });
  it("falls back to last_sign_in_at only without timestamps", () => {
    expect(sessionAuthTime(["password"], "2026-10-16T00:00:00Z")).toBe(Date.parse("2026-10-16T00:00:00Z") / 1000);
    expect(sessionAuthTime([{ method: "password", timestamp: 5 }], "2026-10-16T00:00:00Z")).toBe(5);
  });
  it("is null when nothing is known", () => {
    expect(sessionAuthTime(undefined, undefined)).toBeNull();
    expect(sessionAuthTime([{ method: "password" }], "garbage")).toBeNull();
  });
});

describe("adminNextStatuses", () => {
  it("never offers refunded and follows the state machine", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(adminNextStatuses(status)).not.toContain(OrderStatus.refunded);
    }
    expect(adminNextStatuses(OrderStatus.preparing)).toEqual([OrderStatus.shipped, OrderStatus.cancelled]);
    expect(adminNextStatuses(OrderStatus.shipped)).toEqual([OrderStatus.delivered, OrderStatus.rto]);
    expect(adminNextStatuses(OrderStatus.refunded)).toEqual([]);
  });
});

describe("Shiprocket CSV helpers", () => {
  it("quotes and neutralises formula injection", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('12, "A" Street')).toBe('"12, ""A"" Street"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+911234")).toBe("'+911234");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("line\nbreak")).toBe("line break");
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });
  it("splits names without inventing one", () => {
    expect(splitName("Asha Rao")).toEqual({ first: "Asha", last: "Rao" });
    expect(splitName("  Asha  Devi Rao ")).toEqual({ first: "Asha", last: "Devi Rao" });
    expect(splitName("Madonna")).toEqual({ first: "Madonna", last: "Madonna" });
  });
  it("normalises Indian mobiles to 10 digits", () => {
    expect(tenDigitMobile("+91 98765 43210")).toBe("9876543210");
    expect(tenDigitMobile("09876543210")).toBe("9876543210");
    expect(tenDigitMobile("9876543210")).toBe("9876543210");
  });
});
