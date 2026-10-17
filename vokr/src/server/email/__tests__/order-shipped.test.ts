import { describe, expect, it } from "vitest";

import { renderOrderShipped, type OrderShippedData } from "../templates/order-shipped";

function data(overrides: Partial<OrderShippedData> = {}): OrderShippedData {
  return {
    orderNumber: "VK-10001",
    courier: "Delhivery",
    awb: "AWB-998877",
    items: [{ productName: "Model x", sizeLabel: "IN 8", colorway: "Black", quantity: 1 }],
    shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
    siteUrl: "https://vokr.shop/",
    ...overrides,
  };
}

describe("renderOrderShipped", () => {
  it("states the order, courier, AWB, items and where to check status", () => {
    const { subject, text, html } = renderOrderShipped(data());
    expect(subject).toBe("Your Vokr order VK-10001 has shipped");
    expect(text).toContain("Your order VK-10001 has shipped.");
    expect(text).toContain("Courier: Delhivery");
    expect(text).toContain("AWB / tracking number: AWB-998877");
    expect(text).toContain("- Model x · IN 8 · Black · Qty 1");
    expect(text).toContain("Shipping to: Pune, Maharashtra 411001");
    // Trailing slash on the configured site URL is not doubled.
    expect(text).toContain("https://vokr.shop/support-order-status");
    expect(html).toContain('href="https://vokr.shop/support-order-status"');
  });

  it("promises nothing the system does not hold: no courier tracking link, no delivery date", () => {
    const { text, html } = renderOrderShipped(data());
    for (const part of [text, html]) {
      expect(part).not.toMatch(/delhivery\.com|shiprocket\.co|track\?/i);
      expect(part).not.toMatch(/deliver(ed|y) (by|on|within)|business days/i);
    }
  });

  it("escapes every operator- and customer-entered value in the HTML part", () => {
    const { html } = renderOrderShipped(
      data({
        courier: `<script>alert("x")</script>`,
        items: [{ productName: `A & B "Co"`, sizeLabel: "IN 8", colorway: "<b>Red</b>", quantity: 2 }],
        shipTo: { city: "Pu<ne", state: "Maha'rashtra", pincode: "411001" },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Red</b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("A &amp; B &quot;Co&quot;");
    expect(html).toContain("Pu&lt;ne, Maha&#39;rashtra 411001");
  });
});
