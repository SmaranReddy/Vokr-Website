import { CheckoutPaymentMethod, OrderStatus } from "@/generated/prisma/enums";
import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";

import { writeAudit } from "./audit";

/**
 * Orders as Shiprocket's panel "Bulk CSV Import Orders" file (plan §5
 * Phase 10, task 2; Phase 12, task 9). Shiprocket API integration is
 * deliberately deferred (Phase 10 Out of Scope); the operator uploads this.
 *
 * **Header source:** Shiprocket knowledge base, "Bulk CSV Import Orders"
 * (shiprocket.in/knowledgebase/bulk-csv-import-orders), retrieved 16 Oct
 * 2026. Shiprocket rejects a file whose header row differs, so the header
 * strings are exact. The panel's own sample file is authoritative — diff
 * it against {@link SHIPROCKET_HEADERS} before the first real upload
 * (runbook `docs/infrastructure/fulfilment.md`).
 *
 * One row per order line, the order's fields repeated; per-order charges
 * and the shipment weight appear on the order's first row only. Weight is
 * the sum of the variants' catalogue `weight_grams` (product weight —
 * packaging is not modelled). Every Master SKU must already exist in the
 * Shiprocket catalogue.
 */

export const SHIPROCKET_HEADERS = [
  "*Order Id",
  "Order Date as dd-mm-yyyy",
  "*Channel",
  "*Payment Method(COD/Prepaid)",
  "*Customer First Name",
  "*Customer Last Name",
  "*Email",
  "*Customer Mobile",
  "*Shipping Address Line 1",
  "*Shipping Address Line 2",
  "*Shipping Address Country",
  "*Shipping Address State",
  "*Shipping Address City",
  "*Shipping Address Postcode",
  "Billing Address Line 1",
  "Billing Address Line 2",
  "Billing Address Country",
  "Billing Address State",
  "Billing Address City",
  "Billing Address Postcode",
  "*Master SKU",
  "*Product Quantity",
  "*Selling Price(Per Unit Item, Inclusive of Tax)",
  "Discount(Per Unit Item)",
  "Shipping Charges(Per Order)",
  "COD Charges(Per Order)",
  "Gift Wrap Charges(Per Order)",
  "Total Discount (Per Order)",
  "Weight Of Shipment(kg)",
  "Send Notification(True/False)",
  "Comment",
] as const;

/** Shiprocket's channel name for orders not synced from a store integration. */
export const SHIPROCKET_CHANNEL = "CUSTOM";
export const MAX_EXPORT_ORDERS = 500;

/**
 * One CSV cell: quoted when needed, and neutralised against spreadsheet
 * formula injection (a customer-typed address starting with `=`, `+`, `-`
 * or `@` would otherwise execute when the operator opens the file).
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  text = text.replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  const first = parts[0] ?? "";
  // Shiprocket requires a last name; a single-word name repeats it rather than inventing one.
  const last = parts.length > 1 ? parts.slice(1).join(" ") : first;
  return { first, last };
}

/** Indian mobile as 10 digits (drops a +91/0 prefix). */
export function tenDigitMobile(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function ddmmyyyyIst(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${ist.getUTCFullYear()}`;
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

/** Builds the CSV for every order in `status` (oldest first) and audit-logs the export (it decrypts PII). */
export async function exportShiprocketCsv(
  actor: string,
  status: OrderStatus = OrderStatus.preparing,
  requestId?: string,
): Promise<{ csv: string; orderCount: number }> {
  const orders = await prisma.order.findMany({
    where: { status },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      paymentMethod: true,
      contactEmailEnc: true,
      shipNameEnc: true,
      shipPhoneEnc: true,
      shipLine1Enc: true,
      shipLine2Enc: true,
      shipCity: true,
      shipState: true,
      shipPincode: true,
      shippingPaise: true,
      codFeePaise: true,
      discountPaise: true,
      items: {
        select: { sku: true, quantity: true, unitPricePaise: true, variant: { select: { weightGrams: true } } },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { placedAt: "asc" },
    take: MAX_EXPORT_ORDERS,
  });

  const lines = [SHIPROCKET_HEADERS.map(csvCell).join(",")];
  for (const order of orders) {
    const name = splitName(decryptField(order.shipNameEnc));
    const weightGrams = order.items.reduce((total, item) => total + (item.variant?.weightGrams ?? 0) * item.quantity, 0);
    const line2 = order.shipLine2Enc ? decryptField(order.shipLine2Enc) : "";
    const common = {
      email: decryptField(order.contactEmailEnc),
      mobile: tenDigitMobile(decryptField(order.shipPhoneEnc)),
      line1: decryptField(order.shipLine1Enc),
    };
    order.items.forEach((item, index) => {
      const first = index === 0;
      lines.push(
        [
          order.orderNumber,
          ddmmyyyyIst(order.placedAt),
          SHIPROCKET_CHANNEL,
          order.paymentMethod === CheckoutPaymentMethod.cod ? "COD" : "Prepaid",
          name.first,
          name.last,
          common.email,
          common.mobile,
          common.line1,
          // Mandatory in the template; the city stands in when the customer gave no second line.
          line2 || order.shipCity,
          "India",
          order.shipState,
          order.shipCity,
          order.shipPincode,
          "",
          "",
          "",
          "",
          "",
          "",
          item.sku,
          item.quantity,
          rupees(item.unitPricePaise),
          "",
          first ? rupees(order.shippingPaise) : "",
          first && order.codFeePaise > 0 ? rupees(order.codFeePaise) : "",
          "",
          // The first-order discount, so Shiprocket's order value matches what was charged.
          first && order.discountPaise > 0 ? rupees(order.discountPaise) : "",
          first && weightGrams > 0 ? (weightGrams / 1000).toFixed(3) : "",
          "",
          "",
        ]
          .map(csvCell)
          .join(","),
      );
    });
  }

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor,
      action: "export.shiprocket",
      entity: "export",
      entityId: `shiprocket:${status}`,
      after: { orderNumbers: orders.map((order) => order.orderNumber) },
      requestId,
    });
  });
  // CRLF and a BOM: what spreadsheet tools and upload forms expect.
  return { csv: `﻿${lines.join("\r\n")}\r\n`, orderCount: orders.length };
}
