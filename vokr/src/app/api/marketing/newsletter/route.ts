import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { getClientIp } from "@/server/net/client-ip";
import { logFormError, subscribeToNewsletter } from "@/server/marketing/brevo";
import { assertWithinRateLimit } from "@/server/rate-limit";
import { requestIdOf } from "@/server/net/request-id";

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

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      // Not logged: a JSON parse error's message quotes the body it choked on.
      throw new ValidationError("Request body must be JSON.");
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("Enter a valid email address.");
    }

    await subscribeToNewsletter(parsed.data.email);
    return NextResponse.json({ message: "You're on the list." });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logFormError("newsletter", requestId, error);
    return NextResponse.json(body, { status });
  }
}
