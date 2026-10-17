import type { Prisma } from "@/generated/prisma/client";
import { requireServerEnv } from "@/lib/env";

import {
  financialYearOf,
  invoiceNumberFor,
  InvoiceBlockedError,
  parseInvoiceSeller,
  type InvoiceSeller,
} from "./format";

/** The configured seller (decision D3). Throws {@link InvoiceBlockedError} until it is set. */
export function getInvoiceSeller(): InvoiceSeller {
  return parseInvoiceSeller(requireServerEnv());
}

interface IssueOrderRow {
  id: string;
  sellerState: string;
  shipState: string;
  gstSplit: string;
  subtotalPaise: number;
  taxPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  items: {
    hsnCode: string;
    gstRateBps: number;
    lineSubtotalPaise: number;
    lineTaxPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  }[];
}

/**
 * Refuses to invoice anything the order's own snapshot cannot back exactly:
 * an invoice that disagrees with what was charged is worse than none.
 */
export function assertInvoiceable(order: IssueOrderRow, seller: InvoiceSeller): void {
  const refuse = (why: string) => {
    throw new InvoiceBlockedError(`Order cannot be invoiced: ${why}`);
  };
  // Pricing adds these fees with no GST breakdown (`computePricing`). Their
  // GST treatment is a decision (D11 + CA), not something to derive here.
  if (order.shippingPaise !== 0 || order.codFeePaise !== 0) {
    refuse("it carries a shipping or COD fee whose GST treatment is not decided (D11, confirm with the CA).");
  }
  if (order.sellerState !== seller.state) {
    refuse(`it was priced for seller state ${order.sellerState}, but the configured seller is in ${seller.state}.`);
  }
  const intra = order.shipState === seller.state;
  if (order.gstSplit !== (intra ? "intra_state" : "inter_state")) {
    refuse(`its GST split "${order.gstSplit}" does not match seller ${seller.state} → ship-to ${order.shipState}.`);
  }
  if (order.items.length === 0) refuse("it has no lines.");
  for (const item of order.items) {
    if (!item.hsnCode.trim() || item.gstRateBps <= 0) refuse("a line has no HSN code or GST rate (D2).");
    if (item.cgstPaise + item.sgstPaise + item.igstPaise !== item.lineTaxPaise) refuse("a line's tax split does not add up.");
    if (intra ? item.igstPaise !== 0 : item.cgstPaise + item.sgstPaise !== 0) refuse("a line's tax split contradicts the order's GST split.");
  }
  const subtotal = order.items.reduce((sum, item) => sum + item.lineSubtotalPaise, 0);
  const tax = order.items.reduce((sum, item) => sum + item.lineTaxPaise, 0);
  if (subtotal !== order.subtotalPaise || tax !== order.taxPaise) refuse("its lines do not add up to its totals.");
  if (order.subtotalPaise + order.shippingPaise + order.codFeePaise !== order.totalPaise) refuse("its total does not reconcile.");
}

/**
 * Issues the order's tax invoice inside the caller's transaction — the
 * `shipped` transition (CGST Act s.31: at removal of the goods). Idempotent
 * per order. The serial comes from the financial year's counter row,
 * incremented in this same transaction: concurrent issuers serialise on
 * that row, and if anything later in the transaction fails, the number is
 * rolled back with it — no gaps.
 */
export async function issueInvoice(
  tx: Prisma.TransactionClient,
  orderId: string,
  options: { seller?: InvoiceSeller; now?: Date } = {},
): Promise<{ invoiceNumber: string; created: boolean }> {
  const existing = await tx.invoice.findUnique({ where: { orderId }, select: { invoiceNumber: true } });
  if (existing) return { invoiceNumber: existing.invoiceNumber, created: false };

  const seller = options.seller ?? getInvoiceSeller();
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      sellerState: true,
      shipState: true,
      gstSplit: true,
      subtotalPaise: true,
      taxPaise: true,
      shippingPaise: true,
      codFeePaise: true,
      totalPaise: true,
      items: {
        select: {
          hsnCode: true,
          gstRateBps: true,
          lineSubtotalPaise: true,
          lineTaxPaise: true,
          cgstPaise: true,
          sgstPaise: true,
          igstPaise: true,
        },
      },
    },
  });
  assertInvoiceable(order, seller);

  const issuedAt = options.now ?? new Date();
  const financialYear = financialYearOf(issuedAt);
  const [counter] = await tx.$queryRaw<{ last_serial: number }[]>`
    INSERT INTO invoice_counters (financial_year, last_serial, updated_at)
    VALUES (${financialYear}, 1, now())
    ON CONFLICT (financial_year)
    DO UPDATE SET last_serial = invoice_counters.last_serial + 1, updated_at = now()
    RETURNING last_serial
  `;
  if (!counter) throw new Error("invoice counter returned no row");
  const invoiceNumber = invoiceNumberFor(financialYear, counter.last_serial);
  await tx.invoice.create({
    data: {
      orderId,
      invoiceNumber,
      financialYear,
      serial: counter.last_serial,
      seller: { ...seller },
      issuedAt,
    },
    select: { id: true },
  });
  console.info(`[invoices] issued ${invoiceNumber} order=${orderId}`);
  return { invoiceNumber, created: true };
}
