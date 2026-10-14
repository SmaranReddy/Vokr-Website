import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyCheckoutSignature, verifyWebhookSignature } from "../signature";

const SECRET = "whsec_test_fixture_only";
const BODY = JSON.stringify({
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_1", amount: 999500 } } },
});

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Plan §5 Phase 7, Testing Requirements: valid, tampered body, wrong secret, missing header, truncated signature. */
describe("verifyWebhookSignature", () => {
  it("accepts a valid signature over the raw body", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("is case-insensitive on the hex digest and tolerates surrounding whitespace", () => {
    expect(verifyWebhookSignature(BODY, ` ${sign(BODY).toUpperCase()} `, SECRET)).toBe(true);
  });

  it("rejects a body tampered by one byte", () => {
    const tampered = BODY.replace("999500", "999501");
    expect(verifyWebhookSignature(tampered, sign(BODY), SECRET)).toBe(false);
  });

  it("rejects re-serialised JSON (whitespace differs from the signed bytes)", () => {
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyWebhookSignature(reserialised, sign(BODY), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, "another_secret"), SECRET)).toBe(false);
  });

  it.each([null, undefined, ""])("rejects a missing signature header (%s)", (signature) => {
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY).slice(0, 63), SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, sign(BODY).slice(0, 32), SECRET)).toBe(false);
  });

  it("rejects an over-long or non-hex signature without throwing", () => {
    expect(verifyWebhookSignature(BODY, `${sign(BODY)}00`, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "z".repeat(64), SECRET)).toBe(false);
  });

  it("rejects everything when the secret is empty", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, ""), "")).toBe(false);
  });
});

describe("verifyCheckoutSignature", () => {
  const KEY_SECRET = "key_secret_fixture";
  const valid = createHmac("sha256", KEY_SECRET).update("order_1|pay_1").digest("hex");

  it("accepts HMAC(order_id|payment_id)", () => {
    expect(verifyCheckoutSignature("order_1", "pay_1", valid, KEY_SECRET)).toBe(true);
  });

  it("rejects a fabricated payment ID", () => {
    expect(verifyCheckoutSignature("order_1", "pay_forged", valid, KEY_SECRET)).toBe(false);
  });
});
