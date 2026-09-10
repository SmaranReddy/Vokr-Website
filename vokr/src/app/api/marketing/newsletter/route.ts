import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getClientIp } from "@/server/net/client-ip";
import { subscribeToNewsletter } from "@/server/marketing/brevo";
import { assertWithinRateLimit } from "@/server/rate-limit";

const bodySchema = z.object({ email: z.email() }).strict();

/** Real endpoint for the footer signup form (Phase 4 task 10) — was `onsubmit="return false;"` in the legacy markup. */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    await assertWithinRateLimit({
      key: `marketing:newsletter:ip:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Enter a valid email address.");
    }

    await subscribeToNewsletter(parsed.data.email);
    return NextResponse.json({ message: "You're on the list." });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("marketing/newsletter", requestId, error);
    return NextResponse.json(body, { status });
  }
}
