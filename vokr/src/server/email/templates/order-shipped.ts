import { escapeHtml } from "./order-confirmation";

/**
 * Order shipped (plan §5 Phase 11, task 3; Phase 10, task 3) — plain text
 * first, with an HTML alternative.
 *
 * **Copy status: DRAFT, owner sign-off required before ordering opens.**
 * States only what the operator recorded: courier and AWB. It carries no
 * courier tracking link (no courier's URL format is configured here, and
 * a guessed one would be a broken promise) and no delivery estimate.
 */

export interface OrderShippedData {
  orderNumber: string;
  courier: string;
  awb: string;
  items: { productName: string; sizeLabel: string; colorway: string; quantity: number }[];
  shipTo: { city: string; state: string; pincode: string };
  siteUrl: string;
}

export function renderOrderShipped(data: OrderShippedData): { subject: string; text: string; html: string } {
  const trackUrl = `${data.siteUrl.replace(/\/+$/, "")}/support-order-status`;
  const text = [
    "Hello,",
    "",
    `Your order ${data.orderNumber} has shipped.`,
    "",
    `Courier: ${data.courier}`,
    `AWB / tracking number: ${data.awb}`,
    "",
    ...data.items.map((item) => `- ${item.productName} · ${item.sizeLabel} · ${item.colorway} · Qty ${item.quantity}`),
    "",
    `Shipping to: ${data.shipTo.city}, ${data.shipTo.state} ${data.shipTo.pincode}`,
    "",
    `Check your order status with your order number and email address: ${trackUrl}`,
    "",
    "Questions? Just reply to this email.",
    "",
    "— Vokr",
  ].join("\n");

  const e = escapeHtml;
  const html = [
    `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">`,
    `<p>Hello,</p>`,
    `<p>Your order <strong>${e(data.orderNumber)}</strong> has shipped.</p>`,
    `<p>Courier: <strong>${e(data.courier)}</strong><br>AWB / tracking number: <strong>${e(data.awb)}</strong></p>`,
    `<ul>`,
    ...data.items.map(
      (item) => `<li>${e(`${item.productName} · ${item.sizeLabel} · ${item.colorway} · Qty ${item.quantity}`)}</li>`,
    ),
    `</ul>`,
    `<p>Shipping to: ${e(data.shipTo.city)}, ${e(data.shipTo.state)} ${e(data.shipTo.pincode)}</p>`,
    `<p><a href="${e(trackUrl)}">Check your order status</a> with your order number and email address.</p>`,
    `<p>Questions? Just reply to this email.</p>`,
    `<p>— Vokr</p>`,
    `</body></html>`,
  ].join("");

  return { subject: `Your Vokr order ${data.orderNumber} has shipped`, text, html };
}
