import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { encryptField } from "@/server/checkout/crypto";
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

import { exportAccountData } from "../export";
import { PERSONAL_DATA_INVENTORY } from "../inventory";

/**
 * Plan §5 Phase 17, task 4: the export holds everything about the account,
 * decrypted, and nothing about anyone else — against a real Postgres with
 * an order made by a real verified capture.
 */

const SECRET = "whsec_privacy_fixture";
const AMOUNT = 999_500;
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

async function user(): Promise<string> {
  const id = randomUUID();
  await prisma.appUser.create({
    data: { id, email: `${id}@example.com`, displayName: "Asha", phoneEnc: encryptField("+919812345678") },
    select: { id: true },
  });
  userIds.push(id);
  return id;
}

/** A real order (capture → order), then owned by `userId` — the column the export reads. */
async function ownedOrder(userId: string): Promise<string> {
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
  const order = await prisma.order.update({ where: { checkoutSessionId: sessionId }, data: { userId }, select: { orderNumber: true } });
  return order.orderNumber;
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.address.deleteMany({ where: { id: { in: addressIds } } });
  addressIds.length = 0;
  await prisma.order.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
  await prisma.appUser.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("exportAccountData", () => {
  it("holds the account's data, decrypted, and nothing of anyone else's", async () => {
    const me = await user();
    const someoneElse = await user();
    const address = await prisma.address.create({
      data: {
        userId: me,
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
    addressIds.push(address.id);
    const mine = await ownedOrder(me);
    const theirs = await ownedOrder(someoneElse);

    const data = await exportAccountData(me, new Date("2026-10-17T00:00:00Z"));
    const json = JSON.stringify(data);

    expect(data.account).toMatchObject({ id: me, email: `${me}@example.com`, displayName: "Asha", phone: "+919812345678" });
    expect(data.addresses).toEqual([
      expect.objectContaining({ name: "Asha Rao", line1: "12 MG Road", line2: "Flat 4", phone: "+919800000001", city: "Pune", pincode: "411001" }),
    ]);
    expect(data.orders.map((order) => order.orderNumber)).toEqual([mine]);
    expect(data.orders[0]?.shipTo).toMatchObject({ name: "Test Buyer", line1: "1 Test Road", phone: "+919876543210" });
    expect(data.orders[0]?.contactEmail).toBe("buyer@example.com");
    expect(data.orders[0]?.payment).toMatchObject({ status: "captured", amountPaise: AMOUNT });
    expect(data.orders[0]?.emails.map((email) => email.template)).toContain("order_confirmation");

    // Nothing of the other account, and no ciphertext anywhere.
    expect(json).not.toContain(theirs);
    expect(json).not.toContain(someoneElse);
    // `encryptField` output is base64 iv(12 B):tag(16 B):ciphertext — prove the pattern catches it, then that none leaked.
    const CIPHERTEXT = /[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/=]+/;
    expect(encryptField("probe")).toMatch(CIPHERTEXT);
    expect(json).not.toMatch(CIPHERTEXT);
    // Every exclusion is stated in the document itself.
    expect(data.notExported.map((entry) => entry.field)).toEqual(
      PERSONAL_DATA_INVENTORY.filter((entry) => entry.exported !== true).map((entry) => entry.field),
    );
  });

  it("an account with nothing yet exports empty sections, not an error", async () => {
    const me = await user();
    const data = await exportAccountData(me);
    expect(data.orders).toEqual([]);
    expect(data.addresses).toEqual([]);
    expect(data.bags).toEqual([]);
  });
});
