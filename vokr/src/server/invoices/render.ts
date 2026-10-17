import { gstStateCode, isValidGstState } from "@/lib/gst-states";
import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";
import { escapeHtml } from "@/server/email/templates/order-confirmation";
import { NotFoundError } from "@/lib/errors";
import { normalizeOrderNumber } from "@/server/orders/lookup";

import { amountInWords, type InvoiceSeller } from "./format";

/**
 * The tax invoice as a printable HTML page (plan §5 Phase 9, task 8; R11).
 * Fields follow CGST Rules r.46 as read by this codebase — **pending CA
 * review**. Rendered on demand from the order's immutable snapshot and the
 * seller snapshot taken at issue; nothing is recomputed from live prices.
 * Served only through an authorisation check (owner or admin), never from
 * a guessable public URL.
 */

export interface InvoiceLine {
  description: string;
  sku: string;
  hsnCode: string;
  gstRateBps: number;
  quantity: number;
  unitPricePaise: number;
  lineSubtotalPaise: number;
  lineTaxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface InvoiceDocument {
  invoiceNumber: string;
  issuedAt: Date;
  orderNumber: string;
  placedAt: Date;
  seller: InvoiceSeller;
  buyer: { name: string; line1: string; line2: string | null; city: string; state: string; pincode: string };
  placeOfSupply: { state: string; code: string };
  paymentMethod: string;
  lines: InvoiceLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/** Loads one order's invoice. `ownerUserId` limits it to that customer's own order; omit only behind the admin guard. */
export async function loadInvoice(orderNumberInput: string, access: { ownerUserId?: string }): Promise<InvoiceDocument> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  if (!orderNumber) throw new NotFoundError("Invoice not found.");
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      userId: true,
      placedAt: true,
      paymentMethod: true,
      shipNameEnc: true,
      shipLine1Enc: true,
      shipLine2Enc: true,
      shipCity: true,
      shipState: true,
      shipPincode: true,
      subtotalPaise: true,
      taxPaise: true,
      totalPaise: true,
      invoice: { select: { invoiceNumber: true, issuedAt: true, seller: true } },
      items: {
        select: {
          sku: true,
          productName: true,
          sizeLabel: true,
          colorway: true,
          hsnCode: true,
          gstRateBps: true,
          quantity: true,
          unitPricePaise: true,
          lineSubtotalPaise: true,
          lineTaxPaise: true,
          cgstPaise: true,
          sgstPaise: true,
          igstPaise: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  // Another customer's order, an unknown one, and one not yet invoiced are the same 404.
  if (!order || !order.invoice) throw new NotFoundError("Invoice not found.");
  if (access.ownerUserId !== undefined && order.userId !== access.ownerUserId) throw new NotFoundError("Invoice not found.");

  return {
    invoiceNumber: order.invoice.invoiceNumber,
    issuedAt: order.invoice.issuedAt,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    seller: order.invoice.seller as unknown as InvoiceSeller,
    buyer: {
      name: decryptField(order.shipNameEnc),
      line1: decryptField(order.shipLine1Enc),
      line2: order.shipLine2Enc ? decryptField(order.shipLine2Enc) : null,
      city: order.shipCity,
      state: order.shipState,
      pincode: order.shipPincode,
    },
    placeOfSupply: {
      state: order.shipState,
      code: isValidGstState(order.shipState) ? gstStateCode(order.shipState) : "",
    },
    paymentMethod: order.paymentMethod,
    lines: order.items.map((item) => ({
      description: `${item.productName} · ${item.sizeLabel} · ${item.colorway}`,
      sku: item.sku,
      hsnCode: item.hsnCode,
      gstRateBps: item.gstRateBps,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      lineSubtotalPaise: item.lineSubtotalPaise,
      lineTaxPaise: item.lineTaxPaise,
      cgstPaise: item.cgstPaise,
      sgstPaise: item.sgstPaise,
      igstPaise: item.igstPaise,
    })),
    subtotalPaise: order.subtotalPaise,
    taxPaise: order.taxPaise,
    totalPaise: order.totalPaise,
  };
}

const money = (paise: number) =>
  (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const date = (at: Date) =>
  at.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function renderInvoiceHtml(doc: InvoiceDocument): string {
  const e = escapeHtml;
  const intra = doc.lines.every((line) => line.igstPaise === 0);
  const sum = (key: "cgstPaise" | "sgstPaise" | "igstPaise") => doc.lines.reduce((total, line) => total + line[key], 0);
  const taxable = doc.subtotalPaise - doc.taxPaise;
  const taxHead = intra ? "<th>CGST</th><th>SGST</th>" : "<th>IGST</th>";
  const rows = doc.lines
    .map((line, index) => {
      const lineTaxable = line.lineSubtotalPaise - line.lineTaxPaise;
      const taxCells = intra
        ? `<td>${e(percent(line.gstRateBps / 2))}<br>${e(money(line.cgstPaise))}</td><td>${e(percent(line.gstRateBps / 2))}<br>${e(money(line.sgstPaise))}</td>`
        : `<td>${e(percent(line.gstRateBps))}<br>${e(money(line.igstPaise))}</td>`;
      return `<tr><td>${index + 1}</td><td>${e(line.description)}<br><small>SKU ${e(line.sku)}</small></td><td>${e(line.hsnCode)}</td><td class="n">${line.quantity}</td><td class="n">${e(money(line.unitPricePaise))}</td><td class="n">${e(money(lineTaxable))}</td>${taxCells}<td class="n">${e(money(line.lineSubtotalPaise))}</td></tr>`;
    })
    .join("");
  const taxTotals = intra
    ? `<tr><td>CGST</td><td class="n">${e(money(sum("cgstPaise")))}</td></tr><tr><td>SGST</td><td class="n">${e(money(sum("sgstPaise")))}</td></tr>`
    : `<tr><td>IGST</td><td class="n">${e(money(sum("igstPaise")))}</td></tr>`;
  const buyerAddress = [doc.buyer.line1, doc.buyer.line2, `${doc.buyer.city}, ${doc.buyer.state} ${doc.buyer.pincode}`]
    .filter(Boolean)
    .map((part) => e(part as string))
    .join("<br>");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>Tax invoice ${e(doc.invoiceNumber)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;padding:6px;vertical-align:top;text-align:left}th{background:#f2f2f2}
.n{text-align:right}.grid{display:flex;gap:24px;margin:12px 0}.grid>div{flex:1}
.totals{width:auto;margin-left:auto;margin-top:12px}.muted{color:#555}
@media print{body{margin:0}}
</style></head><body>
<h1>Tax Invoice</h1>
<p class="muted">Original for recipient</p>
<div class="grid">
<div><strong>${e(doc.seller.legalName)}</strong><br>${e(doc.seller.address)}<br>State: ${e(doc.seller.state)} (${e(doc.seller.stateCode)})<br>GSTIN: ${e(doc.seller.gstin)}</div>
<div>Invoice no.: <strong>${e(doc.invoiceNumber)}</strong><br>Invoice date: ${e(date(doc.issuedAt))}<br>Order: ${e(doc.orderNumber)} (placed ${e(date(doc.placedAt))})<br>Payment: ${e(doc.paymentMethod === "cod" ? "Cash on delivery" : "Prepaid")}</div>
</div>
<div class="grid">
<div><strong>Billed and shipped to</strong><br>${e(doc.buyer.name)}<br>${buyerAddress}<br>GSTIN: Unregistered</div>
<div>Place of supply: ${e(doc.placeOfSupply.state)}${doc.placeOfSupply.code ? ` (${e(doc.placeOfSupply.code)})` : ""}<br>Tax payable on reverse charge: No</div>
</div>
<table><thead><tr><th>#</th><th>Description</th><th>HSN</th><th class="n">Qty</th><th class="n">Unit price (incl. GST)</th><th class="n">Taxable value</th>${taxHead}<th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tbody>
<tr><td>Taxable value</td><td class="n">${e(money(taxable))}</td></tr>
${taxTotals}
<tr><td><strong>Invoice total (₹)</strong></td><td class="n"><strong>${e(money(doc.totalPaise))}</strong></td></tr>
</tbody></table>
<p>Amount in words: <strong>${e(amountInWords(doc.totalPaise))}</strong></p>
<p style="margin-top:40px">For ${e(doc.seller.legalName)}<br><br>Authorised signatory</p>
</body></html>`;
}
