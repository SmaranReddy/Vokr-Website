import { clientEnv, requireServerEnv } from "@/lib/env";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
}

/**
 * Only Razorpay **test-mode** keys are accepted. Live payments need D3
 * (legal entity, GST registration, KYC — R16) and the end-to-end
 * payment/inventory/order/shipping/GST/admin tests that Phases 8–12 add,
 * so a live key fails here rather than taking real money. Lifting this is
 * a reviewed code change, the same discipline as `ORDERING_ENABLED`.
 */
export const RAZORPAY_LIVE_MODE_ALLOWED: boolean = false;

const TEST_KEY_PREFIX = "rzp_test_";

/** Throws if the key pair is missing, or is a live key while live mode is not allowed. Read at the point of use, never at module load, so an unconfigured environment still serves every non-payment page. */
export function requireRazorpayConfig(): RazorpayConfig {
  const keyId = clientEnv.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const keySecret = requireServerEnv().RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "Razorpay is not configured: NEXT_PUBLIC_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.",
    );
  }
  assertKeyModeAllowed(keyId);
  return { keyId, keySecret };
}

export function assertKeyModeAllowed(keyId: string): void {
  if (!RAZORPAY_LIVE_MODE_ALLOWED && !keyId.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Razorpay key "${keyId.slice(0, TEST_KEY_PREFIX.length)}…" is not a test-mode key; live mode is disabled (RAZORPAY_LIVE_MODE_ALLOWED).`,
    );
  }
}

/** `undefined` when unset — the webhook route then refuses every delivery rather than accepting unverifiable ones. */
export function getRazorpayWebhookSecret(): string | undefined {
  return requireServerEnv().RAZORPAY_WEBHOOK_SECRET || undefined;
}
