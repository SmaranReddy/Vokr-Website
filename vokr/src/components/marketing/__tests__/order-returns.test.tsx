import axe from "axe-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuestOrderView } from "@/server/orders/lookup";
import type { CustomerReturnView, GuestReturns } from "@/server/returns/service";

/**
 * Returns and exchanges under a found order (plan §5 Phase 10, task 7).
 * The server decides what can be requested; the form only offers that,
 * sends exactly the documented fields, and shows the server's answers.
 */

const { OrderReturns, describeReturn } = await import("../order-returns");
const { OrderLookup } = await import("../order-lookup");

const AXE_TIMEOUT_MS = 20_000;
const CREDENTIALS = { orderNumber: "VK-10234", email: "buyer@example.com" };

function line(overrides: Partial<GuestReturns["lines"][number]> = {}): GuestReturns["lines"][number] {
  return {
    sku: "VK-MX-WHT-IN08",
    productName: "Model X",
    sizeLabel: "IN 8",
    colorway: "White",
    availableUnits: 1,
    hasOpenRequest: false,
    exchangeSizes: ["IN 9", "IN 10"],
    ...overrides,
  };
}

function returnRow(overrides: Partial<CustomerReturnView> = {}): CustomerReturnView {
  return {
    id: "r1",
    kind: "return",
    state: "requested",
    reason: "size_fit",
    sku: "VK-MX-BLK-IN07",
    productName: "Model X",
    sizeLabel: "IN 7",
    colorway: "Black",
    quantity: 1,
    exchangeSize: null,
    requestedAt: "2026-10-16T10:00:00.000Z",
    refund: null,
    replacement: null,
    ...overrides,
  };
}

let lookupReply: { status: number; body: unknown };
let requestReply: { status: number; body: unknown };
let orderReply: { status: number; body: unknown };
const calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  lookupReply = { status: 200, body: { returns: [], open: true, windowClosesAt: "2026-11-15T10:00:00.000Z", lines: [line()] } satisfies GuestReturns };
  requestReply = { status: 201, body: { return: returnRow() } };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const reply = url === "/api/returns/lookup" ? lookupReply : url === "/api/returns/request" ? requestReply : orderReply;
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrderReturns", () => {
  it("offers the server's lines and sends exactly the return request's fields", async () => {
    render(<OrderReturns {...CREDENTIALS} />);
    expect(calls[0]).toEqual({ url: "/api/returns/lookup", body: CREDENTIALS });
    expect(await screen.findByText(/until 15 Nov 2026/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Exchange or return" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "defective" } });
    fireEvent.click(screen.getByRole("button", { name: "Request return" }));

    expect(await screen.findByText(/Request received\. We'll review it and email you with pickup or drop-off details\./)).toBeTruthy();
    expect(calls[1]).toEqual({
      url: "/api/returns/request",
      body: { ...CREDENTIALS, sku: "VK-MX-WHT-IN08", quantity: 1, kind: "return", reason: "defective" },
    });
    expect(calls[2]?.url).toBe("/api/returns/lookup"); // refreshed
  });

  it("an exchange picks a size from the server's list only", async () => {
    render(<OrderReturns {...CREDENTIALS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exchange or return" }));
    fireEvent.click(screen.getByLabelText("Exchange for another size"));
    const sizes = within(screen.getByLabelText("New size")).getAllByRole("option").map((option) => option.textContent);
    expect(sizes).toEqual(["IN 9", "IN 10"]);
    fireEvent.change(screen.getByLabelText("New size"), { target: { value: "IN 10" } });
    fireEvent.click(screen.getByRole("button", { name: "Request exchange" }));
    await screen.findByText(/Request received/);
    expect(calls[1]?.body).toEqual({ ...CREDENTIALS, sku: "VK-MX-WHT-IN08", quantity: 1, kind: "exchange", reason: "size_fit", exchangeSize: "IN 10" });
  });

  it("disables exchange when no other size is available, and offers quantity only for several units", async () => {
    lookupReply = { status: 200, body: { returns: [], open: true, windowClosesAt: "2026-11-15T10:00:00.000Z", lines: [line({ exchangeSizes: [], availableUnits: 2 })] } };
    render(<OrderReturns {...CREDENTIALS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exchange or return" }));
    expect((screen.getByRole("radio", { name: /Exchange for another size/ }) as HTMLInputElement).disabled).toBe(true);
    expect(within(screen.getByLabelText("Quantity")).getAllByRole("option")).toHaveLength(2);
  });

  it("shows the server's refusal as it is", async () => {
    requestReply = { status: 409, body: { error: { code: "CONFLICT", message: "The 30-day return window for this order closed on 2026-11-15." } } };
    render(<OrderReturns {...CREDENTIALS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exchange or return" }));
    fireEvent.click(screen.getByRole("button", { name: "Request return" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The 30-day return window for this order closed on 2026-11-15.");
  });

  it("after the window: existing requests only, no form", async () => {
    lookupReply = {
      status: 200,
      body: { returns: [returnRow({ state: "completed", refund: { amountPaise: 999_500, status: "refunded" } })], open: false, windowClosesAt: "2026-10-01T10:00:00.000Z", lines: [line()] },
    };
    render(<OrderReturns {...CREDENTIALS} />);
    expect(await screen.findByText("Refunded to your original payment method.")).toBeTruthy();
    expect(screen.getByText(/window for new exchange or return requests on this order has closed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Exchange or return" })).toBeNull();
  });

  it("has no serious structural accessibility violations with the form open", async () => {
    lookupReply = { status: 200, body: { returns: [returnRow()], open: true, windowClosesAt: "2026-11-15T10:00:00.000Z", lines: [line()] } };
    const { container } = render(<OrderReturns {...CREDENTIALS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exchange or return" }));
    fireEvent.click(screen.getByLabelText("Exchange for another size"));
    const result = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  }, AXE_TIMEOUT_MS);
});

describe("describeReturn: only what has happened", () => {
  it("never promises a label and never calls an operator-recorded refund confirmed", () => {
    const all = [
      returnRow(),
      returnRow({ state: "approved" }),
      returnRow({ state: "received" }),
      returnRow({ state: "completed", refund: { amountPaise: 1, status: "recorded" } }),
      returnRow({ state: "completed", refund: { amountPaise: 1, status: "queued" } }),
    ].map(describeReturn);
    for (const text of all) expect(text).not.toMatch(/label/i);
    expect(all[3]).not.toMatch(/^Refunded/);
    expect(describeReturn(returnRow({ kind: "exchange", state: "completed", replacement: { courier: "Delhivery", awb: "AWB1", dispatchedAt: "x" } }))).toBe(
      "Replacement shipped with Delhivery, AWB AWB1.",
    );
  });
});

describe("OrderLookup shows returns only from delivery on", () => {
  function order(status: GuestOrderView["status"]): GuestOrderView {
    return {
      orderNumber: "VK-10234",
      status,
      placedAt: "2026-10-15T10:00:00.000Z",
      timeline: [{ status, at: "2026-10-15T10:00:00.000Z" }],
      items: [{ productName: "Model X", sizeLabel: "IN 8", colorway: "White", quantity: 1, lineSubtotalPaise: 999_500 }],
      subtotalPaise: 999_500,
      shippingPaise: 0,
      codFeePaise: 0,
      totalPaise: 999_500,
      shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
    };
  }
  async function track() {
    fireEvent.change(screen.getByLabelText("Order number"), { target: { value: CREDENTIALS.orderNumber } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: CREDENTIALS.email } });
    fireEvent.click(screen.getByRole("button", { name: "Track Order" }));
    await screen.findByText("VK-10234");
  }

  it("a delivered order loads its returns with the same credentials", async () => {
    orderReply = { status: 200, body: { order: order("delivered") } };
    render(<OrderLookup />);
    await track();
    expect(await screen.findByRole("heading", { name: "Exchange or return" })).toBeTruthy();
    expect(calls.map((call) => call.url)).toEqual(["/api/orders/lookup", "/api/returns/lookup"]);
    expect(calls[1]?.body).toEqual(CREDENTIALS);
  });

  it("an order not yet delivered makes no returns call", async () => {
    orderReply = { status: 200, body: { order: order("shipped") } };
    render(<OrderLookup />);
    await track();
    expect(calls.map((call) => call.url)).toEqual(["/api/orders/lookup"]);
    expect(screen.queryByRole("heading", { name: "Exchange or return" })).toBeNull();
  });
});
