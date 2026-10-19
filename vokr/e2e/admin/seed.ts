/**
 * Seeds placed orders for the local admin browser test (`admin.spec.ts`).
 *
 * Reuses the integration-test fixtures and the real order path: priced
 * session → reservation → payment order → verified `payment.captured`
 * webhook → order. Razorpay is an in-process fake (no network), the webhook
 * secret a local string. Refuses any database that is not local or whose
 * name lacks `e2e`.
 *
 *   DATABASE_URL=postgresql://…@localhost:55432/vokr_admin_e2e tsx e2e/admin/seed.ts [count]
 */
import { createHmac, randomUUID } from "node:crypto";

import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import { newCheckoutFixtures, pricedSession, stockedVariant } from "@/server/inventory/__tests__/checkout-fixtures";
import type { RazorpayClient, RazorpayOrder } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

const SECRET = "whsec_local_admin_e2e";
const AMOUNT = 999_500;

function assertLocalDatabase(): void {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const database = url.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !database.includes("e2e")) {
    throw new Error(`Refusing to seed ${url.hostname}/${database}: must be local and named *e2e*.`);
  }
}

class FakeRazorpay implements RazorpayClient {
  readonly orders = new Map<string, RazorpayOrder>();
  async createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    const order = { id: `order_${randomUUID().replaceAll("-", "").slice(0, 14)}`, amount: input.amountPaise, currency: "INR", receipt: input.receipt, status: "created" };
    this.orders.set(order.id, order);
    return order;
  }
  async findOrderByReceipt(receipt: string) {
    return [...this.orders.values()].find((order) => order.receipt === receipt) ?? null;
  }
  async listOrderPayments() {
    return [];
  }
}

async function placedOrder(): Promise<string> {
  const fixtures = newCheckoutFixtures();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, new FakeRazorpay());
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId: `evt_${randomUUID()}`, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { orderNumber: true } });
  return order.orderNumber;
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const count = Number(process.argv[2] ?? "3");
  const numbers: string[] = [];
  for (let i = 0; i < count; i += 1) numbers.push(await placedOrder());
  console.log(JSON.stringify({ orders: numbers }));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
