import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ prisma: {} }));

const { observationFromEvent } = await import("../webhook");

function event(
  type: string,
  payment: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    event: type,
    payload: { ...(payment ? { payment: { entity: payment } } : {}), ...extra },
  };
}

const PAYMENT = {
  id: "pay_1",
  order_id: "order_1",
  amount: 999500,
  currency: "INR",
  status: "captured",
};

describe("observationFromEvent", () => {
  it.each([
    ["payment.authorized", "authorized"],
    ["payment.captured", "captured"],
    ["payment.failed", "failed"],
    ["order.paid", "captured"],
  ])("%s -> %s", (type, status) => {
    expect(observationFromEvent(event(type, PAYMENT))).toEqual({
      providerOrderId: "order_1",
      providerPaymentId: "pay_1",
      status,
      amountPaise: 999500,
      currency: "INR",
    });
  });

  it("refund.processed only moves the payment on a full refund", () => {
    expect(
      observationFromEvent(event("refund.processed", { ...PAYMENT, status: "refunded" }))?.status,
    ).toBe("refunded");
    expect(
      observationFromEvent(event("refund.processed", { ...PAYMENT, status: "captured" })),
    ).toBeNull();
  });

  it("unknown event types assert nothing", () => {
    expect(observationFromEvent(event("payment.dispute.created", PAYMENT))).toBeNull();
    expect(observationFromEvent({ event: 42 })).toBeNull();
  });

  it("an event missing an amount, currency or order ID asserts nothing", () => {
    expect(
      observationFromEvent(event("payment.captured", { ...PAYMENT, amount: "999500" })),
    ).toBeNull();
    expect(
      observationFromEvent(event("payment.captured", { ...PAYMENT, currency: undefined })),
    ).toBeNull();
    expect(
      observationFromEvent(event("payment.captured", { ...PAYMENT, order_id: null })),
    ).toBeNull();
  });

  it("order.paid falls back to the order entity's ID", () => {
    const observation = observationFromEvent(
      event("order.paid", { ...PAYMENT, order_id: undefined }, { order: { entity: { id: "order_9" } } }),
    );
    expect(observation?.providerOrderId).toBe("order_9");
  });
});
