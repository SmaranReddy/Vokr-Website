import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Obviously fake, test-only seller (NOT the answer to decision D3). Set
// before any import: server env is parsed once, at module load. The
// fixtures price orders as an intra-state Maharashtra sale.
vi.hoisted(() => {
  process.env.INVOICE_SELLER_LEGAL_NAME = "TEST SELLER (NOT REAL)";
  process.env.INVOICE_SELLER_GSTIN = "27AAAAA0000A1Z5";
  process.env.INVOICE_SELLER_ADDRESS = "1 Test Lane, Pune 411001";
  process.env.CHECKOUT_SELLER_STATE = "Maharashtra";
});

import { OrderStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { adminTransitionOrder } from "@/server/admin/orders";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
} from "@/server/inventory/__tests__/checkout-fixtures";
import type { RazorpayClient, RazorpayOrder } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { financialYearOf, invoiceNumberFor, parseInvoiceSeller } from "../format";
import { issueInvoice } from "../issue";
import { loadInvoice, renderInvoiceHtml } from "../render";

/**
 * Plan §5 Phase 9 Testing Requirements: "invoice numbering has no gaps
 * under concurrent creation" — against a real Postgres, with orders made
 * by a real verified capture. Far-future financial years isolate the
 * numbering tests from each other and from anything else.
 */

const SECRET = "whsec_invoice_fixture";
const AMOUNT = 999_500;
const ACTOR = `admin:${randomUUID()}`;
const SELLER = parseInvoiceSeller({
  INVOICE_SELLER_LEGAL_NAME: process.env.INVOICE_SELLER_LEGAL_NAME,
  INVOICE_SELLER_GSTIN: process.env.INVOICE_SELLER_GSTIN,
  INVOICE_SELLER_ADDRESS: process.env.INVOICE_SELLER_ADDRESS,
  CHECKOUT_SELLER_STATE: process.env.CHECKOUT_SELLER_STATE,
});
const TEST_YEARS = ["2090-91", "2091-92", "2092-93"];
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const orderIds: string[] = [];

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

/** A real order (capture → order). `totalPaise` above the line subtotal becomes a shipping fee, as in real pricing. */
async function placedOrder(totalPaise = AMOUNT): Promise<{ orderId: string; orderNumber: string }> {
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: totalPaise, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { id: true, orderNumber: true } });
  orderIds.push(order.id);
  return { orderId: order.id, orderNumber: order.orderNumber };
}

async function counter(financialYear: string): Promise<number> {
  const row = await prisma.invoiceCounter.findUnique({ where: { financialYear }, select: { lastSerial: true } });
  return row?.lastSerial ?? 0;
}

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: orderIds } }, { actor: ACTOR }] } });
  orderIds.length = 0;
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.invoiceCounter.deleteMany({ where: { financialYear: { in: TEST_YEARS } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("issuing through the ship transition", () => {
  it("ships with the next serial for the financial year, once, and audits it", async () => {
    const order = await placedOrder();
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });
    const year = financialYearOf(new Date());
    const before = await counter(year);

    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-112233" });
    // A replayed ship issues nothing more.
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-112233" });

    const expected = invoiceNumberFor(year, before + 1);
    const invoices = await prisma.invoice.findMany({ where: { orderId: order.orderId }, select: { invoiceNumber: true, seller: true } });
    expect(invoices).toEqual([{ invoiceNumber: expected, seller: { ...SELLER } }]);
    expect(await counter(year)).toBe(before + 1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: order.orderId, action: "order.transition", after: { path: ["status"], equals: "shipped" } },
      select: { after: true },
    });
    expect(audit.after).toMatchObject({ invoiceNumber: expected, awb: "AWB-112233" });
  });

  it("refuses to ship an order it cannot invoice — and takes no number", async () => {
    // ₹99 more than the lines: the fixture records it as a shipping fee, whose GST treatment is undecided (D11).
    const order = await placedOrder(AMOUNT + 9_900);
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });
    const year = financialYearOf(new Date());
    const before = await counter(year);

    await expect(
      adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-445566" }),
    ).rejects.toThrow(/D11/);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      select: { status: true, awb: true, invoice: { select: { id: true } }, emails: { select: { template: true } } },
    });
    expect(row).toMatchObject({ status: OrderStatus.preparing, awb: null, invoice: null });
    expect(row.emails.map((email) => email.template)).not.toContain("order_shipped");
    expect(await counter(year)).toBe(before);
  });
});

describe("gap-free numbering", () => {
  it("concurrent issuers get contiguous serials", async () => {
    const orders = await Promise.all(Array.from({ length: 6 }, () => placedOrder()));
    const now = new Date("2090-06-01T00:00:00Z");
    const issued = await Promise.all(
      orders.map((order) => prisma.$transaction((tx) => issueInvoice(tx, order.orderId, { seller: SELLER, now }))),
    );
    expect(issued.map((invoice) => invoice.invoiceNumber).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map((serial) => invoiceNumberFor("2090-91", serial)),
    );
    expect(await counter("2090-91")).toBe(6);
  });

  it("a transaction that fails after taking a number gives it back", async () => {
    const [first, second] = [await placedOrder(), await placedOrder()];
    const now = new Date("2091-06-01T00:00:00Z");
    await expect(
      prisma.$transaction(async (tx) => {
        await issueInvoice(tx, first.orderId, { seller: SELLER, now });
        throw new Error("something later in the ship transaction failed");
      }),
    ).rejects.toThrow(/later in the ship/);
    expect(await counter("2091-92")).toBe(0);
    expect(await prisma.invoice.count({ where: { orderId: first.orderId } })).toBe(0);

    const a = await prisma.$transaction((tx) => issueInvoice(tx, second.orderId, { seller: SELLER, now }));
    const b = await prisma.$transaction((tx) => issueInvoice(tx, first.orderId, { seller: SELLER, now }));
    expect([a.invoiceNumber, b.invoiceNumber]).toEqual([invoiceNumberFor("2091-92", 1), invoiceNumberFor("2091-92", 2)]);
    // Idempotent per order.
    await expect(prisma.$transaction((tx) => issueInvoice(tx, first.orderId, { seller: SELLER, now }))).resolves.toEqual({
      invoiceNumber: b.invoiceNumber,
      created: false,
    });
  });

  it("numbers restart at 1 April 00:00 IST", async () => {
    const [march, april] = [await placedOrder(), await placedOrder()];
    const lastSecond = await prisma.$transaction((tx) =>
      issueInvoice(tx, march.orderId, { seller: SELLER, now: new Date("2092-03-31T18:29:59Z") }),
    );
    const firstSecond = await prisma.$transaction((tx) =>
      issueInvoice(tx, april.orderId, { seller: SELLER, now: new Date("2092-03-31T18:30:00Z") }),
    );
    expect(lastSecond.invoiceNumber).toBe("VK/9192/000001");
    expect(firstSecond.invoiceNumber).toBe("VK/9293/000001");
  });
});

describe("reading an invoice", () => {
  it("is the owner's or an admin's; anyone else, an unknown order and an uninvoiced one are the same 404", async () => {
    const order = await placedOrder();
    await expect(loadInvoice(order.orderNumber, {})).rejects.toBeInstanceOf(NotFoundError); // not issued yet
    await prisma.$transaction((tx) => issueInvoice(tx, order.orderId, { seller: SELLER, now: new Date("2090-07-01T00:00:00Z") }));

    const ownerId = randomUUID();
    await prisma.appUser.create({ data: { id: ownerId, email: `${ownerId}@example.com` }, select: { id: true } });
    try {
      await prisma.order.update({ where: { id: order.orderId }, data: { userId: ownerId }, select: { id: true } });
      const doc = await loadInvoice(order.orderNumber, { ownerUserId: ownerId });
      expect(doc.invoiceNumber).toBe("VK/9091/000001");
      expect(doc.buyer.name).toBe("Test Buyer");
      const html = renderInvoiceHtml(doc);
      expect(html).toContain("VK/9091/000001");
      expect(html).toContain("Rupees Nine Thousand Nine Hundred Ninety-Five Only");

      await expect(loadInvoice(order.orderNumber, { ownerUserId: randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
      await expect(loadInvoice("VK-1", {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(loadInvoice(order.orderNumber, {})).resolves.toMatchObject({ invoiceNumber: "VK/9091/000001" });
      await prisma.order.update({ where: { id: order.orderId }, data: { userId: null }, select: { id: true } });
    } finally {
      await prisma.appUser.delete({ where: { id: ownerId } });
    }
  });

  it("an issued invoice cannot be edited", async () => {
    const order = await placedOrder();
    await prisma.$transaction((tx) => issueInvoice(tx, order.orderId, { seller: SELLER, now: new Date("2090-08-01T00:00:00Z") }));
    await expect(
      prisma.invoice.update({ where: { orderId: order.orderId }, data: { invoiceNumber: "VK/9091/999999" } }),
    ).rejects.toThrow(/immutable/);
  });
});

it("a refused issue is a 409 the admin sees, not a 500", async () => {
  const order = await placedOrder(AMOUNT + 4_900);
  await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });
  await expect(
    adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-778899" }),
  ).rejects.toBeInstanceOf(ConflictError);
});
