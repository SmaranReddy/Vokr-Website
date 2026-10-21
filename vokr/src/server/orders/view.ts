import type { OrderStatus } from "@/generated/prisma/enums";

/** What every order read selects for the tracker view — never the encrypted PII columns. */
export const ORDER_VIEW_SELECT = {
  orderNumber: true,
  status: true,
  placedAt: true,
  subtotalPaise: true,
  discountPaise: true,
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
} as const;

export interface OrderView {
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  timeline: { status: OrderStatus; at: string }[];
  items: { productName: string; sizeLabel: string; colorway: string; quantity: number; lineSubtotalPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  shipTo: { city: string; state: string; pincode: string };
}

interface OrderViewRow {
  orderNumber: string;
  status: OrderStatus;
  placedAt: Date;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  shipCity: string;
  shipState: string;
  shipPincode: string;
  items: OrderView["items"];
  history: { toStatus: OrderStatus; createdAt: Date }[];
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
    discountPaise: order.discountPaise,
    shippingPaise: order.shippingPaise,
    codFeePaise: order.codFeePaise,
    totalPaise: order.totalPaise,
    shipTo: { city: order.shipCity, state: order.shipState, pincode: order.shipPincode },
  };
}
