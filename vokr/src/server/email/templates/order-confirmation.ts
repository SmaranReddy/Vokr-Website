import { formatPaiseAsRupees } from "@/lib/currency";

/**
 * Order confirmation (plan §5 Phase 11, task 3) — plain text first, with an
 * HTML alternative.
 *
 * **Copy status: DRAFT, owner sign-off required before ordering opens.**
 * It states only facts the system holds: what was ordered, what was paid
 * and its GST breakdown, where it ships, and how to track it. It makes no
 * promise about delivery times or invoices (those are owner policy — D2/D3
 * for invoices). Every value is HTML-escaped in the HTML part.
 */

export interface OrderConfirmationData {
  orderNumber: string;
  placedAt: Date;
  items: { productName: string; sizeLabel: string; colorway: string; quantity: number; lineSubtotalPaise: number }[];
  subtotalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  /** Included in the subtotal (prices are GST-inclusive). */
  gst: { cgstPaise: number; sgstPaise: number; igstPaise: number };
  shipTo: { city: string; state: string; pincode: string };
  /** `https://vokr.shop` — from configuration, never from a request. */
  siteUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
}

function gstLines(gst: OrderConfirmationData["gst"]): [string, number][] {
  return gst.igstPaise > 0
    ? [["IGST (included)", gst.igstPaise]]
    : [
        ["CGST (included)", gst.cgstPaise],
        ["SGST (included)", gst.sgstPaise],
      ];
}

export function renderOrderConfirmation(data: OrderConfirmationData): { subject: string; text: string; html: string } {
  const trackUrl = `${data.siteUrl.replace(/\/+$/, "")}/support-order-status`;
  const rupees = formatPaiseAsRupees;
  const summary: [string, number][] = [
    ["Subtotal (incl. GST)", data.subtotalPaise],
    ...gstLines(data.gst),
    ["Shipping", data.shippingPaise],
    ...(data.codFeePaise > 0 ? ([["COD handling fee", data.codFeePaise]] as [string, number][]) : []),
  ];

  const text = [
    "Hello,",
    "",
    `Thank you for your order. We've received your payment of ${rupees(data.totalPaise)}.`,
    "",
    `Order ${data.orderNumber} — placed ${formatDate(data.placedAt)}`,
    "",
    ...data.items.map(
      (item) => `- ${item.productName} · ${item.sizeLabel} · ${item.colorway} · Qty ${item.quantity}: ${rupees(item.lineSubtotalPaise)}`,
    ),
    "",
    ...summary.map(([label, paise]) => `${label}: ${paise === 0 && label === "Shipping" ? "Free" : rupees(paise)}`),
    `Total paid: ${rupees(data.totalPaise)}`,
    "",
    `Shipping to: ${data.shipTo.city}, ${data.shipTo.state} ${data.shipTo.pincode}`,
    "",
    `Track your order with your order number and this email address: ${trackUrl}`,
    "",
    "Questions? Just reply to this email.",
    "",
    "— Vokr",
  ].join("\n");

  const e = escapeHtml;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 12px 4px 0">${strong ? `<strong>${e(label)}</strong>` : e(label)}</td><td style="padding:4px 0;text-align:right">${strong ? `<strong>${e(value)}</strong>` : e(value)}</td></tr>`;
  const html = [
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">`,
    `<p>Hello,</p>`,
    `<p>Thank you for your order. We've received your payment of <strong>${e(rupees(data.totalPaise))}</strong>.</p>`,
    `<p><strong>Order ${e(data.orderNumber)}</strong> — placed ${e(formatDate(data.placedAt))}</p>`,
    `<table style="border-collapse:collapse">`,
    ...data.items.map((item) =>
      row(`${item.productName} · ${item.sizeLabel} · ${item.colorway} · Qty ${item.quantity}`, rupees(item.lineSubtotalPaise)),
    ),
    ...summary.map(([label, paise]) => row(label, paise === 0 && label === "Shipping" ? "Free" : rupees(paise))),
    row("Total paid", rupees(data.totalPaise), true),
    `</table>`,
    `<p>Shipping to: ${e(data.shipTo.city)}, ${e(data.shipTo.state)} ${e(data.shipTo.pincode)}</p>`,
    `<p><a href="${e(trackUrl)}">Track your order</a> with your order number and this email address.</p>`,
    `<p>Questions? Just reply to this email.</p>`,
    `<p>— Vokr</p>`,
    `</body></html>`,
  ].join("");

  return { subject: `Your Vokr order ${data.orderNumber}`, text, html };
}
