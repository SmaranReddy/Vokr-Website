import axe from "axe-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderSummary } from "@/server/orders/history";

/** Signed-in order history and detail (plan §5 Phase 9, task 7): every state the server can answer with. */

const { OrderDetail, OrderHistory } = await import("../order-history");

/** axe in jsdom is slow; under load it can pass the default 5 s. */
const AXE_TIMEOUT_MS = 20_000;

let replies: Record<string, { status: number; body: unknown }[]> = {};
const urls: string[] = [];

function summary(orderNumber: string, overrides: Partial<OrderSummary> = {}): OrderSummary {
  return { orderNumber, status: "confirmed", placedAt: "2026-10-15T10:00:00.000Z", totalPaise: 999_500, itemCount: 1, ...overrides };
}

beforeEach(() => {
  replies = {};
  urls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const queue = replies[url] ?? [];
      const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 500, body: {} };
      return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrderHistory", () => {
  it("lists orders with links, then pages back", async () => {
    replies["/api/orders"] = [{ status: 200, body: { orders: [summary("VK-10003", { status: "shipped", itemCount: 2 })], nextBefore: "VK-10003" } }];
    replies["/api/orders?before=VK-10003"] = [{ status: 200, body: { orders: [summary("VK-10001")], nextBefore: null } }];
    render(<OrderHistory />);

    const link = await screen.findByRole("link", { name: /VK-10003/ });
    expect(link.getAttribute("href")).toBe("/orders/VK-10003");
    expect(link.textContent).toMatch(/2 items/);
    expect(link.textContent).toMatch(/Shipped/);

    fireEvent.click(screen.getByRole("button", { name: "Show older orders" }));
    expect(await screen.findByRole("link", { name: /VK-10001/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older orders" })).toBeNull();
  });

  it("signed out: points to sign-in, and to Order Status for guest orders", async () => {
    replies["/api/orders"] = [{ status: 401, body: { error: { code: "UNAUTHORIZED" } } }];
    render(<OrderHistory />);

    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe("/sign-in");
    expect(screen.getByRole("link", { name: "Order Status" }).getAttribute("href")).toBe("/support-order-status");
  });

  it("no orders yet says so", async () => {
    replies["/api/orders"] = [{ status: 200, body: { orders: [], nextBefore: null } }];
    render(<OrderHistory />);
    expect(await screen.findByText(/haven't placed any orders yet/i)).toBeTruthy();
  });

  it("a failure is an alert, not an empty list", async () => {
    replies["/api/orders"] = [{ status: 500, body: {} }];
    render(<OrderHistory />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't load your orders/i);
  });

  it("has no serious structural accessibility violations", async () => {
    replies["/api/orders"] = [{ status: 200, body: { orders: [summary("VK-10003")], nextBefore: null } }];
    const { container } = render(<OrderHistory />);
    await screen.findByRole("link", { name: /VK-10003/ });
    const result = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  }, AXE_TIMEOUT_MS);
});

describe("OrderDetail", () => {
  it("shows the order through the shared tracker", async () => {
    replies["/api/orders/VK-10003"] = [
      {
        status: 200,
        body: {
          order: {
            orderNumber: "VK-10003",
            status: "shipped",
            placedAt: "2026-10-15T10:00:00.000Z",
            timeline: [],
            items: [{ productName: "Model x", sizeLabel: "IN 8", colorway: "Black", quantity: 1, lineSubtotalPaise: 999_500 }],
            subtotalPaise: 999_500,
            shippingPaise: 0,
            codFeePaise: 0,
            totalPaise: 999_500,
            shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
          },
        },
      },
    ];
    render(<OrderDetail orderNumber="VK-10003" />);
    expect((await screen.findByText("Shipped")).getAttribute("aria-current")).toBe("step");
  });

  it("links the order's own tax invoice and credit note when they exist", async () => {
    replies["/api/orders/VK-10004"] = [
      {
        status: 200,
        body: {
          order: {
            orderNumber: "VK-10004",
            status: "refunded",
            placedAt: "2026-10-15T10:00:00.000Z",
            timeline: [],
            items: [{ productName: "Model x", sizeLabel: "IN 8", colorway: "Black", quantity: 1, lineSubtotalPaise: 999_500 }],
            subtotalPaise: 999_500,
            shippingPaise: 0,
            codFeePaise: 0,
            totalPaise: 999_500,
            shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
            invoiceNumber: "VK/2627/000001",
            creditNoteNumber: "VKC/2627/000001",
          },
        },
      },
    ];
    render(<OrderDetail orderNumber="VK-10004" />);
    const invoice = await screen.findByRole("link", { name: "Tax invoice VK/2627/000001" });
    expect(invoice.getAttribute("href")).toBe("/api/orders/VK-10004/invoice");
    const credit = screen.getByRole("link", { name: "Credit note VKC/2627/000001" });
    expect(credit.getAttribute("href")).toBe("/api/orders/VK-10004/invoice?type=credit-note");
  });

  it("someone else's (or no such) order is 'not found on your account'", async () => {
    replies["/api/orders/VK-10009"] = [{ status: 404, body: { error: { code: "NOT_FOUND" } } }];
    render(<OrderDetail orderNumber="VK-10009" />);
    expect(await screen.findByText(/couldn't find that order on your account/i)).toBeTruthy();
  });
});
