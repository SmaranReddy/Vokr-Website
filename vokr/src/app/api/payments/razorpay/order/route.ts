import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getSession } from "@/server/auth/session";
import { applyCookies, type CookieWrite } from "@/server/auth/supabase";
import { assertOrderingEnabled } from "@/server/cart/ordering-gate";
import { requireRazorpayConfig } from "@/server/payments/config";
import { assertPaymentOrderAllowed } from "@/server/payments/rate-limit";
import { createRazorpayClient } from "@/server/payments/razorpay";
import { createPaymentOrder } from "@/server/payments/service";

/** Strict: an `amount` (or anything else) in the body is a 400, not ignored — the amount only ever comes from the pricing snapshot. */
const bodySchema = z.object({ checkoutSessionId: z.uuid() }).strict();

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    assertOrderingEnabled();

    const session = await getSession(request);
    cookiesToSet = session.cookiesToSet;

    await assertPaymentOrderAllowed(request, session.identity);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }

    const config = requireRazorpayConfig();
    const order = await createPaymentOrder(
      session.identity,
      parsed.data.checkoutSessionId,
      createRazorpayClient(config),
    );
    return applyCookies(
      NextResponse.json({ order, keyId: config.keyId }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("payments/razorpay/order", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
