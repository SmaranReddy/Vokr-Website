import { describe, expect, it } from "vitest";

import { renderOrderConfirmation, type OrderConfirmationData } from "../templates/order-confirmation";

function data(overrides: Partial<OrderConfirmationData> = {}): OrderConfirmationData {
  return {
    orderNumber: "VK-10001",
    placedAt: new Date("2026-10-16T10:00:00Z"),
    items: [{ productName: "Model x", sizeLabel: "IN 8", colorway: "Black", quantity: 1, lineSubtotalPaise: 999_500 }],
    subtotalPaise: 999_500,
    discountPaise: 0,
    shippingPaise: 0,
    codFeePaise: 0,
    totalPaise: 999_500,
    gst: { cgstPaise: 76_233, sgstPaise: 76_233, igstPaise: 0 },
    shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
    siteUrl: "https://vokr.shop/",
    ...overrides,
  };
}

describe("renderOrderConfirmation", () => {
  it("states the order, the amount paid, the GST split and how to track it", () => {
    const { subject, text, html } = renderOrderConfirmation(data());
    expect(subject).toBe("Your Vokr order VK-10001");
    expect(text).toContain("We've received your payment of ₹9,995");
    expect(text).toContain("Order VK-10001");
    expect(text).toContain("CGST (included)");
    expect(text).toContain("SGST (included)");
    expect(text).not.toContain("IGST");
    expect(text).toContain("Shipping: Free");
    expect(text).toContain("Shipping to: Pune, Maharashtra 411001");
    expect(text).toContain("https://vokr.shop/support-order-status");
    expect(html).toContain('href="https://vokr.shop/support-order-status"');
  });

  it("an inter-state order shows IGST; a COD fee gets its own line", () => {
    const { text } = renderOrderConfirmation(data({ gst: { cgstPaise: 0, sgstPaise: 0, igstPaise: 152_466 }, codFeePaise: 5_000, totalPaise: 1_004_500 }));
    expect(text).toContain("IGST (included)");
    expect(text).not.toContain("CGST");
    expect(text).toContain("COD handling fee");
  });

  it("a first-order discount gets its own line between the subtotal and the GST", () => {
    const { text, html } = renderOrderConfirmation(data({ discountPaise: 100_000, totalPaise: 899_500 }));
    expect(text).toContain("First order discount (10%): −₹1,000");
    expect(text.indexOf("First order discount")).toBeLessThan(text.indexOf("CGST (included)"));
    expect(text).toContain("Total paid: ₹8,995");
    expect(html).toContain("−₹1,000");
    expect(renderOrderConfirmation(data()).text).not.toContain("discount");
  });

  it("escapes every value in the HTML part", () => {
    const { html } = renderOrderConfirmation(
      data({ items: [{ productName: "<script>x</script>", sizeLabel: '"8"', colorway: "B&W", quantity: 1, lineSubtotalPaise: 999_500 }] }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("&quot;8&quot;");
    expect(html).toContain("B&amp;W");
  });

  it("makes no delivery-time or invoice promise (owner policy, not yet decided)", () => {
    const { text } = renderOrderConfirmation(data());
    expect(text).not.toMatch(/deliver(ed|y) (in|within)|business days|invoice/i);
  });
});
