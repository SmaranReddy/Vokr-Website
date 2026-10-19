import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { ConsentPurpose } from "@/generated/prisma/enums";
import { getClientIp } from "@/server/net/client-ip";
import { recordConsent } from "@/server/privacy/consent";
import { subscribeToNewsletter } from "@/server/marketing/brevo";
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

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Enter a valid email address.");
    }

    // Subscribing is consent to marketing email; recorded first, so no
    // subscription exists without its record (plan §5 Phase 17, task 2).
    await recordConsent({ email: parsed.data.email, purpose: ConsentPurpose.marketing_email, source: "newsletter_form", ip });
    await subscribeToNewsletter(parsed.data.email);
    return NextResponse.json({ message: "You're on the list." });
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("marketing/newsletter", requestId, error);
    return NextResponse.json(body, { status });
  }
}
