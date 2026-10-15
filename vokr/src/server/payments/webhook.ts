import { PaymentProvider, PaymentStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

import { applyPaymentObservation, toPaymentStatus, type PaymentObservation } from "./apply";
import { verifyWebhookSignature } from "./signature";

export interface WebhookResult {
  status: number;
  body: { ok: boolean; duplicate?: boolean; error?: string };
}

interface RazorpayPaymentEntity {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  error_code?: unknown;
  error_reason?: unknown;
}

interface RazorpayEnvelope {
  event?: unknown;
  created_at?: unknown;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: { id?: unknown; status?: unknown } };
    refund?: { entity?: { id?: unknown; payment_id?: unknown; amount?: unknown; status?: unknown } };
  };
}

/** Events that carry a payment-attempt fact. Everything else is stored and acknowledged, never rejected (plan §5 Phase 7, task 7). */
const PAYMENT_EVENTS = new Set([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "order.paid",
  "refund.processed",
]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Only identifiers, amounts and outcome codes are kept. Razorpay's payment
 * entity also carries the customer's contact, email, VPA and card/bank
 * descriptors; none of that is needed to drive payment state, so none of it
 * is persisted or logged (Security Requirements: "card and UPI details
 * never logged").
 */
function redact(envelope: RazorpayEnvelope): Prisma.InputJsonValue {
  const payment = envelope.payload?.payment?.entity;
  const order = envelope.payload?.order?.entity;
  const refund = envelope.payload?.refund?.entity;
  return {
    event: str(envelope.event),
    created_at: typeof envelope.created_at === "number" ? envelope.created_at : null,
    payment: payment
      ? {
          id: str(payment.id),
          order_id: str(payment.order_id),
          amount: typeof payment.amount === "number" ? payment.amount : null,
          currency: str(payment.currency),
          status: str(payment.status),
          error_code: str(payment.error_code),
          error_reason: str(payment.error_reason),
        }
      : null,
    order: order ? { id: str(order.id), status: str(order.status) } : null,
    refund: refund
      ? {
          id: str(refund.id),
          payment_id: str(refund.payment_id),
          amount: typeof refund.amount === "number" ? refund.amount : null,
          status: str(refund.status),
        }
      : null,
  };
}

/** The payment fact an event asserts, or `null` if it asserts none this phase acts on. */
export function observationFromEvent(envelope: RazorpayEnvelope): PaymentObservation | null {
  const eventType = str(envelope.event);
  if (!eventType || !PAYMENT_EVENTS.has(eventType)) return null;

  const entity = envelope.payload?.payment?.entity;
  const providerPaymentId = str(entity?.id);
  const providerOrderId = str(entity?.order_id) ?? str(envelope.payload?.order?.entity?.id);
  const amountPaise = entity?.amount;
  const currency = str(entity?.currency);
  if (!providerPaymentId || !providerOrderId || typeof amountPaise !== "number" || !currency) {
    return null;
  }

  let status: PaymentStatus | null;
  if (eventType === "order.paid") {
    status = PaymentStatus.captured;
  } else if (eventType === "refund.processed") {
    // The refund entity decides, never the payment's summary `status`
    // (which reads `refunded` while a full refund is still pending). Only
    // one processed refund, of this payment, covering its whole amount
    // moves it; anything less leaves it `captured` — partial refunds are
    // Phase 12's manual path, and refund-entity sums are checked by the
    // late-payment job against Razorpay's API.
    const refund = envelope.payload?.refund?.entity;
    const full =
      str(refund?.status) === "processed" &&
      str(refund?.payment_id) === providerPaymentId &&
      typeof refund?.amount === "number" &&
      refund.amount >= amountPaise;
    status = full ? PaymentStatus.refunded : null;
  } else {
    status = toPaymentStatus(eventType.slice("payment.".length));
  }
  if (!status) return null;

  return { providerOrderId, providerPaymentId, status, amountPaise, currency };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * `POST /api/webhooks/razorpay` (plan §5 Phase 7, tasks 6–9):
 *
 * 1. Refuse everything when no webhook secret is configured.
 * 2. Verify `X-Razorpay-Signature` over the raw body, constant-time.
 * 3. Insert into `webhook_events`; a repeated `x-razorpay-event-id` hits
 *    `UNIQUE(provider, provider_event_id)` and is acknowledged untouched.
 * 4. Apply the event in a transaction. Once the event is stored the
 *    response is 2xx even if applying it failed — a 5xx would only make
 *    Razorpay pile retries behind a bug; the failure is kept on the row
 *    and the reconciliation job re-reads the truth from Razorpay.
 */
export async function handleRazorpayWebhook(input: {
  rawBody: string;
  signature: string | null;
  eventId: string | null;
  secret: string | undefined;
}): Promise<WebhookResult> {
  if (!input.secret) {
    console.error("[webhooks/razorpay] refused: RAZORPAY_WEBHOOK_SECRET is not configured");
    return { status: 503, body: { ok: false, error: "not_configured" } };
  }
  if (!verifyWebhookSignature(input.rawBody, input.signature, input.secret)) {
    console.warn("[webhooks/razorpay] refused: invalid signature");
    return { status: 400, body: { ok: false, error: "invalid_signature" } };
  }
  if (!input.eventId) {
    console.warn("[webhooks/razorpay] refused: missing x-razorpay-event-id");
    return { status: 400, body: { ok: false, error: "missing_event_id" } };
  }

  let envelope: RazorpayEnvelope;
  try {
    envelope = JSON.parse(input.rawBody) as RazorpayEnvelope;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_json" } };
  }
  const eventType = str(envelope.event) ?? "unknown";

  let stored: { id: string };
  try {
    stored = await prisma.webhookEvent.create({
      data: {
        provider: PaymentProvider.razorpay,
        providerEventId: input.eventId,
        eventType,
        payload: redact(envelope),
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      console.info(`[webhooks/razorpay] duplicate event=${input.eventId} type=${eventType} — ignored`);
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    throw error;
  }

  let processingError: string | null = null;
  try {
    const observation = observationFromEvent(envelope);
    if (observation) {
      const outcome = await prisma.$transaction((tx) => applyPaymentObservation(tx, observation));
      if (outcome.kind === "rejected") processingError = outcome.reason;
      else if (outcome.warning) processingError = outcome.warning;
      console.info(
        `[webhooks/razorpay] event=${input.eventId} type=${eventType} outcome=${outcome.kind} amount=${observation.amountPaise}`,
      );
    } else {
      console.info(`[webhooks/razorpay] event=${input.eventId} type=${eventType} stored, no action`);
    }
  } catch (error) {
    processingError = error instanceof Error ? error.message : String(error);
    console.error(`[webhooks/razorpay] event=${input.eventId} processing failed`, error);
  }

  await prisma.webhookEvent
    .update({
      where: { id: stored.id },
      data: { processedAt: new Date(), processingError },
      select: { id: true },
    })
    .catch((error: unknown) =>
      console.error(`[webhooks/razorpay] event=${input.eventId} could not record outcome`, error),
    );

  return { status: 200, body: { ok: true } };
}
