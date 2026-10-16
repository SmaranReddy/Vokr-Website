import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getRazorpayWebhookSecret } from "@/server/payments/config";
import { assertWebhookAllowed } from "@/server/payments/rate-limit";
import { handleRazorpayWebhook } from "@/server/payments/webhook";
import { requestIdOf } from "@/server/net/request-id";

/**
 * Unauthenticated by design; the HMAC signature is the authentication.
 * Not behind the `ORDERING_ENABLED` gate: if a payment ever exists, its
 * outcome must still be recorded. With no `RAZORPAY_WEBHOOK_SECRET`
 * configured (the state of production today) every delivery is refused.
 *
 * The body is read exactly once, as text, before anything parses it —
 * the signature is over those bytes.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = await assertWebhookAllowed(request);
    const rawBody = await request.text();
    const result = await handleRazorpayWebhook({
      rawBody,
      signature: request.headers.get("x-razorpay-signature"),
      eventId: request.headers.get("x-razorpay-event-id"),
      secret: getRazorpayWebhookSecret(),
    });
    if (result.status !== 200) {
      console.warn(`[webhooks/razorpay] ${result.status} from ip=${ip}`);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("webhooks/razorpay", requestId, error);
    return NextResponse.json(body, { status });
  }
}
