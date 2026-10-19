import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ConsentAction, ConsentPurpose, DataSubjectRequestState, OrderStatus } from "@/generated/prisma/enums";
import { decryptField, encryptField } from "@/server/checkout/crypto";
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

import { consentSubjectHash, PRIVACY_POLICY_VERSION, recordConsent } from "../consent";
import { decideErasure, ERASED, ERASURE_EXECUTION_ENABLED, executeErasure, previewErasure, requestErasure } from "../erasure";
import { exportAccountData } from "../export";
import { applyRetention, RETENTION_PURGE_ENABLED } from "../retention";

/**
 * Plan §5 Phase 17 Testing Requirements, against a real Postgres:
 * consent is append-only; erasure removes PII while the order stays
 * financially intact; an unapproved (or disabled) erasure changes nothing;
 * retention reports without deleting, and purges only what is safe.
 */

const SECRET = "whsec_privacy_dpdp_fixture";
const AMOUNT = 999_500;
const ACTOR = "admin:00000000-0000-7000-8000-000000000001";
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];
const userIds: string[] = [];
const addressIds: string[] = [];

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

async function user(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await prisma.appUser.create({
    data: { id, email, displayName: "Asha", phoneEnc: encryptField("+919812345678") },
    select: { id: true },
  });
  userIds.push(id);
  return { id, email };
}

/** A real order (verified capture → order), then owned by `userId`. */
async function ownedOrder(userId: string, status: OrderStatus = OrderStatus.delivered) {
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 12)}`, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  return prisma.order.update({
    where: { checkoutSessionId: sessionId },
    data: { userId, status },
    select: { id: true, orderNumber: true, totalPaise: true, taxPaise: true },
  });
}

async function address(userId: string) {
  const row = await prisma.address.create({
    data: {
      userId,
      nameEnc: encryptField("Asha Rao"),
      line1Enc: encryptField("12 MG Road"),
      line2Enc: encryptField("Flat 4"),
      phoneEnc: encryptField("+919800000001"),
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
    },
    select: { id: true },
  });
  addressIds.push(row.id);
  return row.id;
}

async function approved(userId: string, email: string) {
  const { request } = await requestErasure(userId);
  await decideErasure(ACTOR, request.id, { decision: "approve", confirmEmail: email, reason: "customer request" });
  return request.id;
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.address.deleteMany({ where: { id: { in: addressIds } } });
  addressIds.length = 0;
  await prisma.order.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
  await prisma.dataSubjectRequest.deleteMany({ where: { userId: { in: userIds } } });
  // The append-only trigger allows DELETE only when the transaction opts in.
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('vokr.consent_retention_purge', 'on', true)`,
    prisma.consentRecord.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { source: "test_form" }] } }),
  ]);
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("consent records", () => {
  it("records purpose, policy version, source and hashes — never the email or IP", async () => {
    const me = await user();
    await recordConsent({ email: ` ${me.email.toUpperCase()} `, purpose: ConsentPurpose.marketing_email, source: "test_form", ip: "203.0.113.7", userId: me.id });
    const [row] = await prisma.consentRecord.findMany({ where: { userId: me.id } });
    expect(row).toMatchObject({
      purpose: ConsentPurpose.marketing_email,
      action: ConsentAction.granted,
      policyVersion: PRIVACY_POLICY_VERSION,
      source: "test_form",
      subjectHash: consentSubjectHash(me.email),
    });
    expect(row?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(JSON.stringify(row)).not.toContain(me.email);
  });

  it("is append-only: UPDATE and DELETE are refused; withdrawal is a new row", async () => {
    const me = await user();
    await recordConsent({ email: me.email, purpose: ConsentPurpose.marketing_email, source: "test_form", ip: "unknown", userId: me.id });
    await expect(prisma.consentRecord.updateMany({ where: { userId: me.id }, data: { action: ConsentAction.withdrawn } })).rejects.toThrow(/append-only/);
    await expect(prisma.consentRecord.deleteMany({ where: { userId: me.id } })).rejects.toThrow(/append-only/);
    await recordConsent({ email: me.email, purpose: ConsentPurpose.marketing_email, action: ConsentAction.withdrawn, source: "test_form", ip: "unknown", userId: me.id });
    const rows = await prisma.consentRecord.findMany({ where: { userId: me.id }, orderBy: { createdAt: "asc" }, select: { action: true } });
    expect(rows.map((row) => row.action)).toEqual([ConsentAction.granted, ConsentAction.withdrawn]);
  });

  it("the export includes consents given before the account existed (matched by email hash)", async () => {
    const me = await user();
    await recordConsent({ email: me.email, purpose: ConsentPurpose.marketing_email, source: "test_form", ip: "unknown" });
    const data = await exportAccountData(me.id);
    expect(data.consents).toEqual([expect.objectContaining({ purpose: "marketing_email", action: "granted", source: "test_form" })]);
  });
});

describe("erasure", () => {
  it("a request is idempotent, even when sent concurrently", async () => {
    const me = await user();
    const results = await Promise.all([requestErasure(me.id), requestErasure(me.id), requestErasure(me.id)]);
    expect(new Set(results.map((result) => result.request.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await prisma.dataSubjectRequest.count({ where: { userId: me.id } })).toBe(1);
  });

  it("the dry run changes nothing and reports what would happen", async () => {
    const me = await user();
    await address(me.id);
    await ownedOrder(me.id);
    const { request } = await requestErasure(me.id);
    const preview = await previewErasure(request.id);
    expect(preview.executionEnabled).toBe(false);
    expect(preview.report.blockers).toEqual([]);
    expect(preview.report.anonymise).toMatchObject({ account: 1, addresses: 1, orderContacts: 1 });
    expect(preview.report.retained.orderShipTo).toBe(1);
    const after = await prisma.appUser.findUniqueOrThrow({ where: { id: me.id }, select: { email: true, deletedAt: true } });
    expect(after).toEqual({ email: me.email, deletedAt: null });
  });

  it("deciding needs the account email retyped, happens once, and is audited", async () => {
    const me = await user();
    const { request } = await requestErasure(me.id);
    await expect(decideErasure(ACTOR, request.id, { decision: "approve", confirmEmail: "someone@example.com", reason: "customer request" })).rejects.toThrow(/does not match/);
    await decideErasure(ACTOR, request.id, { decision: "reject", confirmEmail: me.email, reason: "duplicate request" });
    await expect(decideErasure(ACTOR, request.id, { decision: "approve", confirmEmail: me.email, reason: "again" })).rejects.toThrow(/already rejected/);
    const audit = await prisma.auditLog.findMany({ where: { entityId: request.id }, select: { action: true, actor: true } });
    expect(audit).toEqual([{ action: "privacy.erasure_reject", actor: ACTOR }]);
    // A rejected request no longer blocks a new one.
    expect((await requestErasure(me.id)).created).toBe(true);
  });

  it("execution is off by default: an approved request changes nothing", async () => {
    expect(ERASURE_EXECUTION_ENABLED).toBe(false);
    const me = await user();
    const id = await approved(me.id, me.email);
    await expect(executeErasure(ACTOR, id)).rejects.toThrow(/disabled until the legal review/);
    const after = await prisma.appUser.findUniqueOrThrow({ where: { id: me.id }, select: { email: true, deletedAt: true } });
    expect(after).toEqual({ email: me.email, deletedAt: null });
  });

  it("refuses an unapproved request, and an account with an order still being fulfilled", async () => {
    const me = await user();
    const { request } = await requestErasure(me.id);
    await expect(executeErasure(ACTOR, request.id, { enabled: true })).rejects.toThrow(/Only an approved request/);

    const busy = await user();
    await ownedOrder(busy.id, OrderStatus.shipped);
    const id = await approved(busy.id, busy.email);
    await expect(executeErasure(ACTOR, id, { enabled: true })).rejects.toThrow(/still being fulfilled/);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { id: busy.id }, select: { deletedAt: true } })).deletedAt).toBeNull();
  });

  it("anonymises PII in place while the order, its totals and payment survive", async () => {
    const me = await user();
    await address(me.id);
    await recordConsent({ email: me.email, purpose: ConsentPurpose.account_terms, source: "test_form", ip: "unknown", userId: me.id });
    const order = await ownedOrder(me.id);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { shipNameEnc: true, shipLine1Enc: true, shipCity: true, payment: { select: { status: true, amountPaise: true } } } });
    const id = await approved(me.id, me.email);

    const result = await executeErasure(ACTOR, id, { enabled: true });
    expect(result.state).toBe(DataSubjectRequestState.completed);

    const account = await prisma.appUser.findUniqueOrThrow({ where: { id: me.id }, select: { email: true, displayName: true, phoneEnc: true, deletedAt: true } });
    expect(account.email).toBe(`erased-${me.id}@erased.invalid`);
    expect(account).toMatchObject({ displayName: null, phoneEnc: null });
    expect(account.deletedAt).not.toBeNull();

    const [addr] = await prisma.address.findMany({ where: { userId: me.id }, select: { nameEnc: true, line1Enc: true, line2Enc: true, phoneEnc: true, city: true } });
    expect(decryptField(addr!.nameEnc)).toBe(ERASED);
    expect(decryptField(addr!.line1Enc)).toBe(ERASED);
    expect(decryptField(addr!.phoneEnc)).toBe(ERASED);
    expect(addr).toMatchObject({ line2Enc: null, city: ERASED });

    const kept = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { orderNumber: true, totalPaise: true, taxPaise: true, contactEmailEnc: true, shipPhoneEnc: true, shipNameEnc: true, shipLine1Enc: true, shipCity: true, payment: { select: { status: true, amountPaise: true } } },
    });
    expect(kept).toMatchObject({ orderNumber: order.orderNumber, totalPaise: order.totalPaise, taxPaise: order.taxPaise, payment: before.payment });
    expect(decryptField(kept.contactEmailEnc)).toBe(`erased-${me.id}@erased.invalid`);
    expect(decryptField(kept.shipPhoneEnc)).toBe(ERASED);
    // Ship-to is the tax invoice's recipient: kept pending legal review (Q1).
    expect(kept).toMatchObject({ shipNameEnc: before.shipNameEnc, shipLine1Enc: before.shipLine1Enc, shipCity: before.shipCity });

    // Proof of consent survives; the request is complete and audited; a second run is refused.
    expect(await prisma.consentRecord.count({ where: { userId: me.id } })).toBe(1);
    const audit = await prisma.auditLog.findMany({ where: { entityId: id }, select: { action: true }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => row.action)).toEqual(["privacy.erasure_approve", "privacy.erasure_execute"]);
    await expect(executeErasure(ACTOR, id, { enabled: true })).rejects.toThrow(/Only an approved request/);
  });

  it("a malformed request id is a 404, not a database error", async () => {
    await expect(previewErasure("not-a-uuid")).rejects.toThrow(/not found/i);
    await expect(executeErasure(ACTOR, "not-a-uuid", { enabled: true })).rejects.toThrow(/not found/i);
  });
});

describe("retention", () => {
  it("reports by default and deletes nothing", async () => {
    expect(RETENTION_PURGE_ENABLED).toBe(false);
    const { sessionId } = await pricedSession(fixtures, { lines: [{ variantId: await stockedVariant(fixtures, 5, AMOUNT), quantity: 1 }], totalPaise: AMOUNT });
    await prisma.$executeRaw`UPDATE checkout_sessions SET contact_email_enc = ${encryptField("old@example.com")}, updated_at = now() - interval '45 days' WHERE id = ${sessionId}::uuid`;
    const report = await applyRetention();
    expect(report.mode).toBe("report");
    expect(report.checkoutContactEmailsPastRetention).toBeGreaterThanOrEqual(1);
    expect(report.checkoutContactEmailsCleared).toBe(0);
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: { contactEmailEnc: true } });
    expect(row.contactEmailEnc).not.toBeNull();
  });

  it("purge clears only old checkout emails that never became an order or hold stock", async () => {
    const variantId = await stockedVariant(fixtures, 5, AMOUNT);
    const stale = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
    const recent = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
    const me = await user();
    const order = await ownedOrder(me.id);
    const ordered = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { checkoutSessionId: true } });
    const email = encryptField("old@example.com");
    await prisma.$executeRaw`UPDATE checkout_sessions SET contact_email_enc = ${email}, updated_at = now() - interval '45 days' WHERE id IN (${stale.sessionId}::uuid, ${ordered.checkoutSessionId}::uuid)`;
    await prisma.$executeRaw`UPDATE checkout_sessions SET contact_email_enc = ${email} WHERE id = ${recent.sessionId}::uuid`;

    const report = await applyRetention({ purge: true });
    expect(report.mode).toBe("purge");
    const rows = await prisma.checkoutSession.findMany({
      where: { id: { in: [stale.sessionId, recent.sessionId, ordered.checkoutSessionId] } },
      select: { id: true, contactEmailEnc: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.contactEmailEnc]));
    expect(byId.get(stale.sessionId)).toBeNull();
    expect(byId.get(recent.sessionId)).not.toBeNull();
    expect(byId.get(ordered.checkoutSessionId)).not.toBeNull();
  });
});
