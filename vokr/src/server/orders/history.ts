import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/server/db/client";

import { normalizeOrderNumber } from "./lookup";
import { ORDER_VIEW_SELECT, toOrderView, type OrderView } from "./view";

/**
 * Signed-in order history and detail (plan §5 Phase 9, task 7). Ownership
 * is checked on every read — an order is the caller's only when its
 * `user_id` is theirs — and another customer's order is the same 404 as one
 * that does not exist.
 *
 * Orders placed as a guest are not attached to an account by matching
 * email: a guest's contact email was never verified, so that would hand a
 * stranger's order to whoever registers the address first. Guest orders are
 * found with order lookup instead.
 */

export const ORDER_HISTORY_PAGE_SIZE = 20;

export interface OrderSummary {
  orderNumber: string;
  status: OrderView["status"];
  placedAt: string;
  totalPaise: number;
  itemCount: number;
}

export async function listUserOrders(
  userId: string,
  options: { before?: string } = {},
): Promise<{ orders: OrderSummary[]; nextBefore: string | null }> {
  const before = options.before ? normalizeOrderNumber(options.before) : null;
  const cursor = before
    ? await prisma.order.findFirst({ where: { orderNumber: before, userId }, select: { placedAt: true, id: true } })
    : null;
  const rows = await prisma.order.findMany({
    where: {
      userId,
      ...(cursor
        ? { OR: [{ placedAt: { lt: cursor.placedAt } }, { placedAt: cursor.placedAt, id: { lt: cursor.id } }] }
        : {}),
    },
    select: {
      orderNumber: true,
      status: true,
      placedAt: true,
      totalPaise: true,
      items: { select: { quantity: true } },
    },
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
    take: ORDER_HISTORY_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, ORDER_HISTORY_PAGE_SIZE);
  return {
    orders: page.map((row) => ({
      orderNumber: row.orderNumber,
      status: row.status,
      placedAt: row.placedAt.toISOString(),
      totalPaise: row.totalPaise,
      itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    nextBefore: rows.length > ORDER_HISTORY_PAGE_SIZE ? (page.at(-1)?.orderNumber ?? null) : null,
  };
}

export async function getUserOrder(userId: string, orderNumberInput: string): Promise<OrderView> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  const order = orderNumber
    ? await prisma.order.findFirst({ where: { orderNumber, userId }, select: ORDER_VIEW_SELECT })
    : null;
  if (!order) throw new NotFoundError("Order not found.");
  return toOrderView(order);
}
