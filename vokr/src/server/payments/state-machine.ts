import { PaymentStatus } from "@/generated/prisma/enums";
import { ConflictError } from "@/lib/errors";

/**
 * `created → authorized → captured | failed | refunded` (plan §5 Phase 7,
 * task 8), applied to one Razorpay *order*, which can see several payment
 * attempts:
 *
 * - `failed` is not terminal. It describes the latest attempt; a retry on
 *   the same order can still authorize or capture.
 * - `captured` only moves to `refunded`; `refunded` is terminal.
 * - Razorpay does not order deliveries, so a stale event (`authorized`
 *   after `captured`, `failed` from attempt 1 after attempt 2 captured)
 *   must be a no-op rather than an error. {@link nextPaymentStatus}
 *   returns `null` for those; processing stays commutative.
 */
const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.created]: [
    PaymentStatus.authorized,
    PaymentStatus.captured,
    PaymentStatus.failed,
  ],
  [PaymentStatus.authorized]: [PaymentStatus.captured, PaymentStatus.failed],
  [PaymentStatus.failed]: [PaymentStatus.authorized, PaymentStatus.captured],
  [PaymentStatus.captured]: [PaymentStatus.refunded],
  [PaymentStatus.refunded]: [],
};

export function isValidPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The status an incoming event moves the payment to, or `null` if the event is stale, a repeat, or would move it backwards. */
export function nextPaymentStatus(
  current: PaymentStatus,
  incoming: PaymentStatus,
): PaymentStatus | null {
  return isValidPaymentTransition(current, incoming) ? incoming : null;
}

export function assertValidPaymentTransition(
  paymentId: string,
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (isValidPaymentTransition(from, to)) {
    console.info(`[payments] payment=${paymentId} transition ${from} -> ${to}`);
    return;
  }
  console.warn(`[payments] payment=${paymentId} REJECTED illegal transition ${from} -> ${to}`);
  throw new ConflictError(`Payment cannot move from "${from}" to "${to}".`);
}
