import { createHmac, randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { toErrorResponse } from "@/lib/errors";
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

import {
  findGuestOrder,
  LOOKUP_LIMITS,
  LOOKUP_NOT_FOUND_MESSAGE,
  LOOKUP_RATE_LIMITED_MESSAGE,
  lookupGuestOrder,
  normalizeOrderNumber,
} from "../lookup";

/**
 * Guest order lookup (plan §5 Phase 9, task 6, Security Requirements),
 * against a real Postgres with real orders made by a verified capture.
 * The fixtures' contact email is `buyer@example.com`.
 */

const SECRET = "whsec_lookup_fixture";
const AMOUNT = 999_500;
const EMAIL = "buyer@example.com";
const fixtures = newCheckoutFixtures();
const eventIds: string[] = [];

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
  const razorpay = new FakeRazorpay();
  const variantId = await stockedVariant(fixtures, 5, AMOUNT);
  const { identity, sessionId } = await pricedSession(fixtures, { lines: [{ variantId, quantity: 1 }], totalPaise: AMOUNT });
  await reserveCheckoutSession(identity, sessionId);
  const { razorpayOrderId } = await createPaymentOrder(identity, sessionId, razorpay);
  const paymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, amount: AMOUNT, currency: "INR", status: "captured" } } },
  });
  const eventId = `evt_${randomUUID()}`;
  eventIds.push(eventId);
  await handleRazorpayWebhook({ rawBody, signature: createHmac("sha256", SECRET).update(rawBody).digest("hex"), eventId, secret: SECRET });
  const order = await prisma.order.findUniqueOrThrow({ where: { checkoutSessionId: sessionId }, select: { orderNumber: true } });
  return order.orderNumber;
}

const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 6)}`;

/** The caller-visible projection of a lookup: status and body, nothing internal. */
async function attempt(body: unknown, sourceIp = ip(), minDurationMs = 0) {
  const startedAt = Date.now();
  try {
    const order = await lookupGuestOrder({ ip: sourceIp, body }, { minDurationMs });
    return { status: 200, body: { order } as unknown, ms: Date.now() - startedAt };
  } catch (error) {
    const response = toErrorResponse(error);
    // The request id differs per call by design; everything else must not.
    const rest: Record<string, unknown> = { ...response.body.error };
    delete rest.requestId;
    return { status: response.status, body: { error: rest } as unknown, ms: Date.now() - startedAt };
  }
}

afterEach(async () => {
  await cleanupCheckoutFixtures(fixtures, eventIds);
  eventIds.length = 0;
  await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: "orders:lookup:" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("normalizeOrderNumber", () => {
  it.each([
    ["VK-10234", "VK-10234"],
    [" vk-10234 ", "VK-10234"],
    ["vk10234", "VK-10234"],
    ["VK-1234567", "VK-1234567"],
  ])("%s -> %s", (input, output) => expect(normalizeOrderNumber(input)).toBe(output));

  it.each(["", "10234", "VK-123", "VK-10234; DROP", "XX-10234", "VK-10234-1"])("rejects %j", (input) =>
    expect(normalizeOrderNumber(input)).toBeNull(),
  );
});

describe("a matching number and email", () => {
  it("returns the order tracker view — with no name, phone or email in it", async () => {
    const orderNumber = await placedOrder();

    const variants = [
      { orderNumber, email: EMAIL },
      { orderNumber: orderNumber.toLowerCase().replace("-", ""), email: "  Buyer@Example.COM " },
    ];
    for (const body of variants) {
      const result = await attempt(body);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        order: {
          orderNumber,
          status: "confirmed",
          totalPaise: AMOUNT,
          timeline: [{ status: "confirmed" }],
          shipTo: { city: "Pune", state: "Maharashtra", pincode: "411001" },
          items: [{ quantity: 1, lineSubtotalPaise: AMOUNT }],
        },
      });
      const serialised = JSON.stringify(result.body);
      expect(serialised).not.toContain("buyer@");
      expect(serialised).not.toContain("Test Buyer");
      expect(serialised).not.toContain("9876543210");
      expect(serialised).not.toContain("Test Road");
    }
  });
});

describe("every failure looks the same", () => {
  it("wrong email, unknown number and malformed number get one identical 404", async () => {
    const orderNumber = await placedOrder();
    const results = [
      await attempt({ orderNumber, email: "someone-else@example.com" }),
      await attempt({ orderNumber: "VK-99999999", email: EMAIL }),
      await attempt({ orderNumber: "not an order", email: EMAIL }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND", message: LOOKUP_NOT_FOUND_MESSAGE } } });
    }
    expect(new Set(results.map((result) => JSON.stringify(result.body))).size).toBe(1);
  });

  it("enumeration: 100 mixed lookups show identical bodies and no timing gap", async () => {
    const orderNumber = await placedOrder();
    const floor = 120;
    const real: number[] = [];
    const fake: number[] = [];
    const bodies = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      // A real number with the wrong email, and a number that does not exist.
      const a = await attempt({ orderNumber, email: `guess${i}@example.com` }, ip(), floor);
      const b = await attempt({ orderNumber: `VK-${80_000_000 + i}`, email: EMAIL }, ip(), floor);
      real.push(a.ms);
      fake.push(b.ms);
      bodies.add(JSON.stringify(a.body));
      bodies.add(JSON.stringify(b.body));
      // Keep the per-number lockout out of this measurement.
      await prisma.rateLimitCounter.deleteMany({ where: { key: { startsWith: "orders:lookup:number:" } } });
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(bodies.size).toBe(1);
    expect(Math.min(...real, ...fake)).toBeGreaterThanOrEqual(floor - 2);
    expect(Math.abs(mean(real) - mean(fake))).toBeLessThan(25);
  }, 60_000);

  it("success is held to the same time floor as failure", async () => {
    const orderNumber = await placedOrder();
    const result = await attempt({ orderNumber, email: EMAIL }, ip(), 150);
    expect(result.status).toBe(200);
    expect(result.ms).toBeGreaterThanOrEqual(148);
  });
});

describe("limits and lockout", () => {
  it("an order number is locked after repeated attempts — real or not, the correct email included", async () => {
    const orderNumber = await placedOrder();
    const unknown = "VK-77777777";
    for (const number of [orderNumber, unknown]) {
      for (let i = 0; i < LOOKUP_LIMITS.perOrderNumber.limit; i += 1) {
        expect((await attempt({ orderNumber: number, email: `wrong${i}@example.com` })).status).toBe(404);
      }
    }
    const lockedReal = await attempt({ orderNumber, email: EMAIL });
    const lockedFake = await attempt({ orderNumber: unknown, email: EMAIL });
    for (const locked of [lockedReal, lockedFake]) {
      expect(locked).toMatchObject({ status: 429, body: { error: { code: "RATE_LIMITED", message: LOOKUP_RATE_LIMITED_MESSAGE } } });
    }
    expect(JSON.stringify(lockedReal.body)).toBe(JSON.stringify(lockedFake.body));
  });

  it("one IP is limited across order numbers", async () => {
    const sourceIp = ip();
    for (let i = 0; i < LOOKUP_LIMITS.perIp.limit; i += 1) {
      expect((await attempt({ orderNumber: `VK-${60_000_000 + i}`, email: EMAIL }, sourceIp)).status).toBe(404);
    }
    expect((await attempt({ orderNumber: "VK-60009999", email: EMAIL }, sourceIp)).status).toBe(429);
    // Another address is unaffected.
    expect((await attempt({ orderNumber: "VK-60009999", email: EMAIL })).status).toBe(404);
  });

  it("a body that is not an order number and email is a 400, not a lookup", async () => {
    expect((await attempt({ orderNumber: "VK-10001" })).status).toBe(400);
    expect((await attempt({ orderNumber: "VK-10001", email: EMAIL, amount: 1 })).status).toBe(400);
  });
});

describe("findGuestOrder", () => {
  it("never throws for a mismatch; returns null", async () => {
    await expect(findGuestOrder("VK-55555555", EMAIL)).resolves.toBeNull();
    await expect(findGuestOrder("garbage", "")).resolves.toBeNull();
  });
});
