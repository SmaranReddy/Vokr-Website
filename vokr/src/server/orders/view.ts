import type { OrderStatus } from "@/generated/prisma/enums";

/** What every order read selects for the tracker view — never the encrypted PII columns. */
export const ORDER_VIEW_SELECT = {
  orderNumber: true,
  status: true,
  placedAt: true,
  subtotalPaise: true,
  shippingPaise: true,
  codFeePaise: true,
  totalPaise: true,
  shipCity: true,
  shipState: true,
  shipPincode: true,
  items: {
    select: { productName: true, sizeLabel: true, colorway: true, quantity: true, lineSubtotalPaise: true },
    orderBy: { id: "asc" },
  },
  history: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  invoice: { select: { invoiceNumber: true } },
  creditNote: { select: { creditNoteNumber: true } },
} as const;

export interface OrderView {
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  timeline: { status: OrderStatus; at: string }[];
  items: { productName: string; sizeLabel: string; colorway: string; quantity: number; lineSubtotalPaise: number }[];
  subtotalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  shipTo: { city: string; state: string; pincode: string };
  /** Tax documents issued for the order (R11): the invoice at shipment, a credit note after a full refund. */
  invoiceNumber: string | null;
  creditNoteNumber: string | null;
}

interface OrderViewRow {
  orderNumber: string;
  status: OrderStatus;
  placedAt: Date;
  subtotalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  shipCity: string;
  shipState: string;
  shipPincode: string;
  items: OrderView["items"];
  history: { toStatus: OrderStatus; createdAt: Date }[];
  invoice: { invoiceNumber: string } | null;
  creditNote: { creditNoteNumber: string } | null;
}

/** One order as the tracker shows it: status, timeline, items, totals, city/state/PIN — no name, phone or email. */
export function toOrderView(order: OrderViewRow): OrderView {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    timeline: order.history.map((row) => ({ status: row.toStatus, at: row.createdAt.toISOString() })),
    items: order.items,
    subtotalPaise: order.subtotalPaise,
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    totalPaise: order.totalPaise,
    shipTo: { city: order.shipCity, state: order.shipState, pincode: order.shipPincode },
    invoiceNumber: order.invoice?.invoiceNumber ?? null,
    creditNoteNumber: order.creditNote?.creditNoteNumber ?? null,
  };
}
