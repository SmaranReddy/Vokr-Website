import { createHmac, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Shipping now issues a tax invoice, which needs seller details (decision
// D3). Obviously fake, test-only values, set before any import (server env
// is parsed once); the fixtures price orders as a Maharashtra sale.
vi.hoisted(() => {
  process.env.INVOICE_SELLER_LEGAL_NAME = "TEST SELLER (NOT REAL)";
  process.env.INVOICE_SELLER_GSTIN = "27AAAAA0000A1Z5";
  process.env.INVOICE_SELLER_ADDRESS = "1 Test Lane, Pune 411001";
  process.env.CHECKOUT_SELLER_STATE = "Maharashtra";
});

import { EmailTemplate, OrderStatus, PaymentIssueState, PaymentStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { reserveCheckoutSession } from "@/server/checkout/reserve";
import { prisma } from "@/server/db/client";
import {
  cleanupCheckoutFixtures,
  newCheckoutFixtures,
  pricedSession,
  stockedVariant,
  stockOf,
} from "@/server/inventory/__tests__/checkout-fixtures";
import type { OutgoingEmail } from "@/server/email/brevo";
import { sendPendingEmails } from "@/server/email/outbox";
import { resolvePaymentIssues } from "@/server/payments/late-payment";
import {
  RazorpayApiError,
  type RazorpayClient,
  type RazorpayOrder,
  type RazorpayPaymentDetail,
  type RazorpayRefund,
  type RazorpayRefundClient,
} from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";
import { handleRazorpayWebhook } from "@/server/payments/webhook";

import { ADMIN_REAUTH_MAX_AGE_S, ADMIN_SESSION_MAX_AGE_S, AdminNotFoundError, AdminReauthRequiredError, isActiveAdmin, resolveAdmin } from "../guard";
import { adjustInventory } from "../inventory";
import {
  ADMIN_REFUND_REASON,
  adminNextStatuses,
  adminTransitionOrder,
  getAdminOrder,
  listAdminOrders,
  requestOrderRefund,
  revealOrderPii,
  transitionSchema,
} from "../orders";
import { csvCell, exportShiprocketCsv, SHIPROCKET_HEADERS } from "../shiprocket-csv";

/**
 * Plan §5 Phase 12 Testing Requirements, against a real Postgres: every
 * mutation writes an audit row; refunds cannot exceed the captured amount;
 * illegal transitions are rejected in the admin path too; non-admins are
 * refused. Orders are made by a real verified capture, as in production.
 */

const SECRET = "whsec_admin_fixture";
const AMOUNT = 999_500;
const ACTOR = `admin:${randomUUID()}`;
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const userIds: string[] = [];
const auditEntityIds: string[] = [];

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

/** Razorpay's refund API as the late-payment tests model it: idempotent by key, never above the captured amount. */
class FakeRefunds implements RazorpayRefundClient {
  readonly payments = new Map<string, RazorpayPaymentDetail>();
  readonly refunds = new Map<string, RazorpayRefund[]>();
  private readonly byKey = new Map<string, RazorpayRefund>();
  createCalls = 0;
  newRefundStatus = "processed";

  captured(id: string, amount = AMOUNT) {
    this.payments.set(id, { id, order_id: null, amount, currency: "INR", status: "captured", amount_refunded: 0, refund_status: null });
  }
  async fetchPayment(paymentId: string) {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    return { ...payment };
  }
  async listPaymentRefunds(paymentId: string) {
    return [...(this.refunds.get(paymentId) ?? [])];
  }
  async createRefund(input: { paymentId: string; amountPaise: number; receipt: string; idempotencyKey: string }) {
    this.createCalls += 1;
    const previous = this.byKey.get(input.idempotencyKey);
    if (previous) return { ...previous };
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new RazorpayApiError(400, "The id provided does not exist");
    if (payment.amount_refunded + input.amountPaise > payment.amount) {
      throw new RazorpayApiError(400, "The refund amount provided is greater than amount captured");
    }
    const refund: RazorpayRefund = {
      id: `rfnd_${randomUUID().replaceAll("-", "").slice(0, 14)}`,
      payment_id: input.paymentId,
      amount: input.amountPaise,
      currency: "INR",
      status: this.newRefundStatus,
      receipt: input.receipt,
    };
    this.byKey.set(input.idempotencyKey, refund);
    this.refunds.set(input.paymentId, [...(this.refunds.get(input.paymentId) ?? []), refund]);
    payment.amount_refunded += input.amountPaise;
    payment.status = "refunded";
    return { ...refund };
  }
}

interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  providerPaymentId: string;
  variantId: string;
}

/** A real order: reserve → Razorpay order → verified `payment.captured` webhook → order. */
async function placedOrder(): Promise<PlacedOrder> {
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const providerPaymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: providerPaymentId, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { id: true, orderNumber: true } });
  auditEntityIds.push(order.id);
  return { orderId: order.id, orderNumber: order.orderNumber, providerPaymentId, variantId };
}

async function auditRows(entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityId },
    select: { actor: true, action: true, before: true, after: true, reason: true },
    orderBy: { createdAt: "asc" },
  });
}

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: auditEntityIds } }, { actor: ACTOR }] } });
  auditEntityIds.length = 0;
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("inventory adjustment (task 5)", () => {
  it("applies the delta, writes the audit row with the reason, and refuses a stale on-hand", async () => {
    const variantId = await stockedVariant(fixtures, 3);
    auditEntityIds.push(variantId);

    await expect(adjustInventory(ACTOR, { variantId, delta: 7, expectedOnHand: 3, reason: "launch stock" })).resolves.toEqual({
      quantityOnHand: 10,
      quantityReserved: 0,
    });
    expect((await stockOf(variantId)).quantityOnHand).toBe(10);
    expect(await auditRows(variantId)).toEqual([
      {
        actor: ACTOR,
        action: "inventory.adjust",
        before: { quantityOnHand: 3, quantityReserved: 0 },
        after: { quantityOnHand: 10, quantityReserved: 0, delta: 7 },
        reason: "launch stock",
      },
    ]);

    // The same submit again (double click): the on-hand it saw is gone.
    await expect(adjustInventory(ACTOR, { variantId, delta: 7, expectedOnHand: 3, reason: "launch stock" })).rejects.toBeInstanceOf(ConflictError);
    expect((await stockOf(variantId)).quantityOnHand).toBe(10);
    expect(await auditRows(variantId)).toHaveLength(1);
  });

  it("two concurrent identical submits apply once", async () => {
    const variantId = await stockedVariant(fixtures, 2);
    auditEntityIds.push(variantId);
    const results = await Promise.allSettled([
      adjustInventory(ACTOR, { variantId, delta: 5, expectedOnHand: 2, reason: "restock" }),
      adjustInventory(ACTOR, { variantId, delta: 5, expectedOnHand: 2, reason: "restock" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(variantId)).quantityOnHand).toBe(7);
    expect(await auditRows(variantId)).toHaveLength(1);
  });

  it("never takes on-hand below units held by live checkouts, or below zero", async () => {
    const variantId = await stockedVariant(fixtures, 3);
    auditEntityIds.push(variantId);
    const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 2 }], totalPaise: 2 * 999_500 });
    await reserveCheckoutSession(identity, sessionId);
    expect(await stockOf(variantId)).toEqual({ quantityOnHand: 3, quantityReserved: 2 });

    await expect(adjustInventory(ACTOR, { variantId, delta: -2, expectedOnHand: 3, reason: "damaged" })).rejects.toBeInstanceOf(ConflictError);
    await expect(adjustInventory(ACTOR, { variantId, delta: -4, expectedOnHand: 3, reason: "damaged" })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjustInventory(ACTOR, { variantId, delta: -1, expectedOnHand: 3, reason: "damaged" })).resolves.toEqual({
      quantityOnHand: 2,
      quantityReserved: 2,
    });
    expect(await auditRows(variantId)).toHaveLength(1);
  });

  it("an unknown variant is a 404", async () => {
    await expect(
      adjustInventory(ACTOR, { variantId: randomUUID(), delta: 1, expectedOnHand: 0, reason: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("order transitions (task 4; Phase 10 task 3)", () => {
  it("moves through the shared state machine with history and audit; illegal moves are refused", async () => {
    const order = await placedOrder();
    expect(adminNextStatuses(OrderStatus.confirmed)).toEqual([OrderStatus.preparing, OrderStatus.cancelled]);

    // Skipping a step is illegal in the admin path too.
    await expect(
      adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB12345" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing, note: "packing" })).resolves.toEqual({
      changed: true,
      status: OrderStatus.preparing,
    });
    // Replay: no change, no second audit row.
    await expect(adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing })).resolves.toEqual({
      changed: false,
      status: OrderStatus.preparing,
    });

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.orderId },
      select: { fromStatus: true, toStatus: true, actor: true, note: true },
      orderBy: { createdAt: "asc" },
    });
    expect(history.at(-1)).toEqual({ fromStatus: OrderStatus.confirmed, toStatus: OrderStatus.preparing, actor: ACTOR, note: "packing" });
    expect(await auditRows(order.orderId)).toEqual([
      {
        actor: ACTOR,
        action: "order.transition",
        before: { status: OrderStatus.confirmed },
        after: { status: OrderStatus.preparing },
        reason: "packing",
      },
    ]);
  });

  it("shipping requires courier + AWB, records them and queues exactly one shipped email", async () => {
    const order = await placedOrder();
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });

    await expect(adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.cancelled, awb: "AWB12345" }),
    ).rejects.toBeInstanceOf(ValidationError);

    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-998877" });
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.shipped, courier: "Other", awb: "AWB-000000" });

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      select: { status: true, courier: true, awb: true, shippedAt: true },
    });
    expect(row).toMatchObject({ status: OrderStatus.shipped, courier: "Delhivery", awb: "AWB-998877" });
    expect(row.shippedAt).toBeInstanceOf(Date);
    const emails = await prisma.emailLog.findMany({ where: { orderId: order.orderId }, select: { template: true, status: true } });
    expect(emails.filter((email) => email.template === EmailTemplate.order_shipped)).toEqual([
      { template: EmailTemplate.order_shipped, status: "pending" },
    ]);

    // The outbox renders and sends it after commit, with the recorded AWB.
    const sent: OutgoingEmail[] = [];
    await sendPendingEmails({ send: async (email) => (sent.push(email), { messageId: `msg-${sent.length}` }) });
    const shipped = sent.find((email) => email.subject.includes("has shipped"));
    expect(shipped?.subject).toBe(`Your Vokr order ${order.orderNumber} has shipped`);
    expect(shipped?.text).toContain("AWB / tracking number: AWB-998877");
    expect(shipped?.text).toContain("Courier: Delhivery");
    const shippedRow = await prisma.emailLog.findFirstOrThrow({
      where: { orderId: order.orderId, template: EmailTemplate.order_shipped },
      select: { status: true },
    });
    expect(shippedRow.status).toBe("sent");
  });

  it("`refunded` cannot be asserted by an operator", () => {
    expect(transitionSchema.safeParse({ to: OrderStatus.refunded }).success).toBe(false);
  });

  it("an unknown or malformed order number is a 404", async () => {
    await expect(adminTransitionOrder(ACTOR, "VK-1", { to: OrderStatus.preparing })).rejects.toBeInstanceOf(NotFoundError);
    await expect(adminTransitionOrder(ACTOR, "nonsense", { to: OrderStatus.preparing })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("refunds (task 6)", () => {
  it("queues a full refund that the maintenance job pays out once, capped at the captured amount; payment and order end refunded", async () => {
    const order = await placedOrder();
    const before = await stockOf(order.variantId);

    await expect(
      requestOrderRefund(ACTOR, order.orderNumber, { confirmOrderNumber: "VK-1", reason: "customer cancelled" }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      requestOrderRefund(ACTOR, order.orderNumber, { confirmOrderNumber: order.orderNumber.toLowerCase(), reason: "customer cancelled" }),
    ).resolves.toEqual({ queued: true, amountPaise: AMOUNT });
    // A second request (double submit, another operator) queues nothing more.
    await expect(
      requestOrderRefund(ACTOR, order.orderNumber, { confirmOrderNumber: order.orderNumber, reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const issue = await prisma.paymentIssue.findUniqueOrThrow({
      where: { providerPaymentId: order.providerPaymentId },
      select: { state: true, reason: true, amountPaise: true },
    });
    expect(issue).toEqual({ state: PaymentIssueState.open, reason: ADMIN_REFUND_REASON, amountPaise: AMOUNT });
    expect((await auditRows(order.orderId)).map((row) => row.action)).toEqual(["order.refund"]);

    const refunds = new FakeRefunds();
    refunds.captured(order.providerPaymentId);
    await resolvePaymentIssues(refunds);
    await resolvePaymentIssues(refunds); // a second run changes nothing

    expect(refunds.createCalls).toBe(1);
    expect(refunds.refunds.get(order.providerPaymentId)?.map((refund) => refund.amount)).toEqual([AMOUNT]);
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: order.orderId },
      select: { status: true, payment: { select: { status: true } } },
    });
    expect(after).toEqual({ status: OrderStatus.refunded, payment: { status: PaymentStatus.refunded } });
    expect(
      (await prisma.paymentIssue.findUniqueOrThrow({ where: { providerPaymentId: order.providerPaymentId }, select: { state: true } })).state,
    ).toBe(PaymentIssueState.refunded);
    // Refunds never restock on their own.
    expect(await stockOf(order.variantId)).toEqual(before);

    await expect(
      requestOrderRefund(ACTOR, order.orderNumber, { confirmOrderNumber: order.orderNumber, reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getAdminOrder(order.orderNumber)).refundable).toBe(false);
  });

  it("a cancelled order can be refunded", async () => {
    const order = await placedOrder();
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.cancelled, note: "out of stock at warehouse" });
    expect((await getAdminOrder(order.orderNumber)).refundable).toBe(true);
    await expect(
      requestOrderRefund(ACTOR, order.orderNumber, { confirmOrderNumber: order.orderNumber, reason: "cancelled" }),
    ).resolves.toMatchObject({ queued: true });
  });
});

describe("PII reveal (task 7) and Shiprocket export (Phase 10 task 2)", () => {
  it("returns decrypted contact details only with an audit row", async () => {
    const order = await placedOrder();
    const customer = await revealOrderPii(ACTOR, order.orderNumber, "courier asked for the phone number");
    expect(customer.email).toContain("@");
    expect(customer.phone).toMatch(/\d{10}/);
    expect(await auditRows(order.orderId)).toEqual([
      { actor: ACTOR, action: "pii.reveal", before: null, after: null, reason: "courier asked for the phone number" },
    ]);
  });

  it("exports preparing orders with Shiprocket's exact header row, one row per line, and audit-logs it", async () => {
    const order = await placedOrder();
    await adminTransitionOrder(ACTOR, order.orderNumber, { to: OrderStatus.preparing });
    const { csv, orderCount } = await exportShiprocketCsv(ACTOR, OrderStatus.preparing);
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(SHIPROCKET_HEADERS.map(csvCell).join(","));
    const mine = lines.filter((line) => line.startsWith(`${order.orderNumber},`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain(",CUSTOM,Prepaid,");
    expect(mine[0]).toContain(",9995.00,");
    expect(orderCount).toBeGreaterThanOrEqual(1);
    const exportAudit = await prisma.auditLog.findFirst({
      where: { actor: ACTOR, action: "export.shiprocket" },
      select: { after: true },
    });
    expect((exportAudit?.after as { orderNumbers: string[] }).orderNumbers).toContain(order.orderNumber);
  });

  it("lists orders by status and by order number", async () => {
    const order = await placedOrder();
    const byNumber = await listAdminOrders({ q: order.orderNumber, page: 1 });
    expect(byNumber.rows.map((row) => row.orderNumber)).toEqual([order.orderNumber]);
    const byStatus = await listAdminOrders({ status: OrderStatus.confirmed, page: 1 });
    expect(byStatus.rows.some((row) => row.orderNumber === order.orderNumber)).toBe(true);
    expect((await listAdminOrders({ q: "not-a-number", page: 1 })).rows).toEqual([]);
  });
});

describe("audit_log integrity", () => {
  it("refuses UPDATE (append-only)", async () => {
    const variantId = await stockedVariant(fixtures, 1);
    auditEntityIds.push(variantId);
    await adjustInventory(ACTOR, { variantId, delta: 1, expectedOnHand: 1, reason: "x-check" });
    await expect(prisma.auditLog.updateMany({ where: { entityId: variantId }, data: { reason: "rewritten" } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe("admin guard (task 1)", () => {
  async function appUser(flags: { isAdmin?: boolean; deleted?: boolean } = {}) {
    const id = randomUUID();
    await prisma.appUser.create({
      data: { id, email: `${id}@example.com`, isAdmin: flags.isAdmin ?? false, deletedAt: flags.deleted ? new Date() : null },
      select: { id: true },
    });
    userIds.push(id);
    return id;
  }

  /** The two Supabase calls the guard makes, faked. */
  function fakeSupabase(user: { id: string; last_sign_in_at?: string } | null, amr?: unknown): SupabaseClient {
    return {
      auth: {
        getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: new Error("no session") }),
        getClaims: async () => ({ data: user ? { claims: { sub: user.id, amr } } : null, error: null }),
      },
    } as unknown as SupabaseClient;
  }
  const now = 2_000_000_000;

  it("only an active admin passes", async () => {
    const plain = await appUser();
    const admin = await appUser({ isAdmin: true });
    const erased = await appUser({ isAdmin: true, deleted: true });
    expect(await isActiveAdmin(plain)).toBe(false);
    expect(await isActiveAdmin(admin)).toBe(true);
    expect(await isActiveAdmin(erased)).toBe(false);
    expect(await isActiveAdmin(randomUUID())).toBe(false);

    const amr = [{ method: "password", timestamp: now - 60 }];
    await expect(resolveAdmin(fakeSupabase(null), { nowS: now })).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(resolveAdmin(fakeSupabase({ id: plain }, amr), { nowS: now })).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(resolveAdmin(fakeSupabase({ id: erased }, amr), { nowS: now })).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(resolveAdmin(fakeSupabase({ id: admin }, amr), { nowS: now })).resolves.toEqual({ adminId: admin, authAgeS: 60 });
  });

  it("bounds the session by when it authenticated, and refunds need a recent sign-in", async () => {
    const admin = await appUser({ isAdmin: true });
    const at = (age: number) => [{ method: "password", timestamp: now - age }];
    await expect(resolveAdmin(fakeSupabase({ id: admin }, at(ADMIN_SESSION_MAX_AGE_S + 1)), { nowS: now })).rejects.toBeInstanceOf(
      AdminNotFoundError,
    );
    await expect(
      resolveAdmin(fakeSupabase({ id: admin }, at(ADMIN_REAUTH_MAX_AGE_S + 1)), { nowS: now, reauthWithinS: ADMIN_REAUTH_MAX_AGE_S }),
    ).rejects.toBeInstanceOf(AdminReauthRequiredError);
    await expect(
      resolveAdmin(fakeSupabase({ id: admin }, at(ADMIN_REAUTH_MAX_AGE_S - 1)), { nowS: now, reauthWithinS: ADMIN_REAUTH_MAX_AGE_S }),
    ).resolves.toMatchObject({ adminId: admin });
    // No timestamp anywhere: fail closed.
    await expect(resolveAdmin(fakeSupabase({ id: admin }, ["password"]), { nowS: now })).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});
