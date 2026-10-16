import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { siteConfig } from "@/config/site";
import { ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { classifyResetResult } from "@/server/auth/reset-error";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";
import { requestIdOf } from "@/server/net/request-id";

const bodySchema = z.object({ email: z.email() }).strict();

/** Identical whether or not `email` is registered — Supabase's own `resetPasswordForEmail()` does not reveal this either. */
const GENERIC_RESET_MESSAGE =
  "If that email is registered, a password reset link is on its way.";

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const ip = getClientIp(request);
    await assertWithinRateLimit({
      key: `auth:reset:ip:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }
    const { email } = parsed.data;

    const normalizedEmail = email.toLowerCase();
    await assertWithinRateLimit({
      key: `auth:reset:email:${normalizedEmail}`,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });

    // A 60-second floor mirroring GoTrue's own recovery cooldown, and the
    // reason this route can report a repeat request honestly at all.
    // Supabase's cooldown is keyed on the user row, so it only trips for
    // a registered address and may not be surfaced (see
    // `classifyResetResult()`); this counter increments for whatever
    // address was submitted, registered or not, so a 429 from it reveals
    // nothing the requester does not already know. Without it, a customer
    // who clicks twice gets "a link is on its way" and no email — exactly
    // the failure this route keeps producing.
    await assertWithinRateLimit({
      key: `auth:reset:email:recent:${normalizedEmail}`,
      limit: 1,
      windowMs: 60 * 1000,
    });

    // Points at the server-side recovery route, not `/reset-password`
    // directly: the link must be redeemable from any browser, and only
    // `verifyOtp()` on the server can do that. Built on `siteConfig.url`
    // rather than the raw env var so an unset NEXT_PUBLIC_SITE_URL cannot
    // produce a relative redirect target. Note the Recovery email template
    // uses `{{ .SiteURL }}/api/auth/reset/confirm?token_hash=...`, so this
    // value is the allow-list check, not the link the customer receives.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteConfig.url}/api/auth/reset/confirm`,
    });

    // This `error` was previously discarded, which turned every failed
    // send into a 200 "link is on its way" — R12's silent-failure
    // signature. See `classifyResetResult()`.
    const outcome = classifyResetResult(error);
    switch (outcome.kind) {
      case "validation":
        throw new ValidationError(outcome.message);
      case "operational":
        // Generic 500 to the caller, full reason to the server log.
        throw new Error(outcome.reason, { cause: error });
      case "silent-failure":
        // Generic *success* to the caller — reporting this one would
        // disclose whether the address is registered — and the real
        // reason to the log, so "no email arrived" is diagnosable.
        logServerError(
          "auth/reset",
          crypto.randomUUID(),
          new Error(outcome.reason, { cause: error }),
        );
        break;
      case "generic-success":
        break;
    }

    return applyCookies(
      NextResponse.json({ message: GENERIC_RESET_MESSAGE }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error, requestIdOf(request));
    logServerError("auth/reset", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
