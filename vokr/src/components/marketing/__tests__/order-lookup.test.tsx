import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuestOrderView } from "@/server/orders/lookup";

/** The real Order Status form (plan §5 Phase 9, task 6). The server decides; the form only shows its answer. */

const { OrderLookup } = await import("../order-lookup");

/** axe in jsdom is slow; under load it can pass the default 5 s. */
const AXE_TIMEOUT_MS = 20_000;

function order(overrides: Partial<GuestOrderView> = {}): GuestOrderView {
  return {
    orderNumber: "VK-10234",
    status: "preparing",
    placedAt: "2026-10-15T10:00:00.000Z",
    timeline: [
      { status: "confirmed", at: "2026-10-15T10:00:00.000Z" },
      { status: "preparing", at: "2026-10-15T12:00:00.000Z" },
    ],
    items: [{ productName: "Model x", sizeLabel: "IN 8", colorway: "Black", quantity: 1, lineSubtotalPaise: 999_500 }],
    subtotalPaise: 999_500,
    shippingPaise: 0,
    codFeePaise: 0,
    totalPaise: 999_500,
    shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
    invoiceNumber: null,
    creditNoteNumber: null,
    ...overrides,
  };
}

let reply: { status: number; body: unknown };
const calls: RequestInit[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit(orderNumber = "VK-10234", email = "buyer@example.com") {
  fireEvent.change(screen.getByLabelText("Order number"), { target: { value: orderNumber } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Track Order" }));
}

describe("OrderLookup", () => {
  it("sends only the order number and email, and draws the tracker at the current step", async () => {
    reply = { status: 200, body: { order: order() } };
    render(<OrderLookup />);
    await submit();

    expect(await screen.findByText("VK-10234")).toBeTruthy();
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ orderNumber: "VK-10234", email: "buyer@example.com" });
    const current = screen.getByText("Preparing to ship");
    expect(current.getAttribute("aria-current")).toBe("step");
    expect(screen.getByText(/Model x · IN 8 · Qty 1/)).toBeTruthy();
    expect(screen.getByText(/Shipping to Pune, Maharashtra 411001/)).toBeTruthy();
  });

  it("never links tax documents for a guest (those routes need the account)", async () => {
    reply = { status: 200, body: { order: order({ status: "shipped", invoiceNumber: "VK/2627/000001" }) } };
    render(<OrderLookup />);
    await submit();

    expect(await screen.findByText("VK-10234")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Tax invoice/ })).toBeNull();
  });

  it("an order that left the tracker says what happened instead", async () => {
    reply = { status: 200, body: { order: order({ status: "refunded" }) } };
    render(<OrderLookup />);
    await submit();

    expect(await screen.findByText(/refunded to your original payment method/i)).toBeTruthy();
    expect(screen.queryByText("Preparing to ship")).toBeNull();
  });

  it("shows the server's one not-found message, whatever was wrong", async () => {
    reply = { status: 404, body: { error: { code: "NOT_FOUND", message: "We couldn't find an order matching those details." } } };
    render(<OrderLookup />);
    await submit("VK-99999", "x@example.com");

    expect(await screen.findByText("We couldn't find an order matching those details.")).toBeTruthy();
  });

  it("has no serious structural accessibility violations with a result shown", async () => {
    reply = { status: 200, body: { order: order() } };
    const { container } = render(<OrderLookup />);
    await submit();
    await screen.findByText("VK-10234");

    const result = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  }, AXE_TIMEOUT_MS);
});
