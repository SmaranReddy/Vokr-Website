import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/;

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a hex HMAC-SHA256 digest. The format check
 * comes first because `timingSafeEqual` throws on unequal lengths — a
 * truncated or padded signature must be a clean `false`, not an exception.
 */
function hexDigestsEqual(expectedHex: string, receivedHex: string): boolean {
  if (!HEX_SHA256.test(receivedHex)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}

/**
 * `X-Razorpay-Signature` = hex HMAC-SHA256 of the **raw** request body,
 * keyed by the webhook secret (plan §5 Phase 7, task 6). The body must be
 * the exact bytes received — re-serialising parsed JSON changes them.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  return hexDigestsEqual(hmacSha256Hex(secret, rawBody), signature.trim().toLowerCase());
}

/**
 * The Checkout handler's `razorpay_signature` = hex HMAC-SHA256 of
 * `"<order_id>|<payment_id>"`, keyed by the API key secret. Used only to
 * decide what the *browser* is told while it waits; it never changes
 * payment state — verified webhooks are the only writer (task 5).
 */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string | null | undefined,
  keySecret: string,
): boolean {
  if (!signature || !keySecret) return false;
  return hexDigestsEqual(
    hmacSha256Hex(keySecret, `${orderId}|${paymentId}`),
    signature.trim().toLowerCase(),
  );
}
