import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getClientIp } from "@/server/net/client-ip";
import { sendContactMessage } from "@/server/marketing/brevo";
import { assertWithinRateLimit } from "@/server/rate-limit";

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email(),
    orderNumber: z.string().trim().max(50).optional(),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();

/** Real endpoint for `support-contact.html`'s form (Phase 4 task 10). */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    await assertWithinRateLimit({
      key: `marketing:contact:ip:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
      );
    }

    const { orderNumber, ...rest } = parsed.data;
    await sendContactMessage({
      ...rest,
      message: orderNumber
        ? `Order number: ${orderNumber}\n\n${rest.message}`
        : rest.message,
    });
    return NextResponse.json({
      message: "Thanks — we'll get back to you soon.",
    });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("marketing/contact", requestId, error);
    return NextResponse.json(body, { status });
  }
}
