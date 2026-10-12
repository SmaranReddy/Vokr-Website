import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { siteConfig } from "@/config/site";
import { RateLimitError, ValidationError, toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import { getOrCreateAppUser } from "@/server/auth/app-user";
import {
  MIN_PASSWORD_LENGTH,
  isPasswordBreached,
} from "@/server/auth/password";
import { classifySignupResult } from "@/server/auth/signup-error";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";

const bodySchema = z
  .object({
    email: z.email(),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
  })
  .strict();

/**
 * Identical response whether or not `email` is already registered. When
 * email confirmations are required, Supabase's own `signUp()` returns a
 * user object with an empty `identities` array for a duplicate address —
 * no error — which is the anti-enumeration behaviour this route relies on
 * rather than re-implementing. `classifySignupResult()` folds the
 * explicit already-registered error codes into this same message, and
 * *only* those: every other Supabase failure is reported as a failure.
 */
const GENERIC_SIGNUP_MESSAGE =
  "If that email isn't already registered, a confirmation link is on its way.";

export async function POST(request: NextRequest) {
  // Constructed inside the try block, not before it: if Supabase's public
  // config is missing (env not yet configured), client construction itself
  // throws, and that failure must still return through toErrorResponse()
  // rather than bubbling up as an unhandled 500.
  let cookiesToSet: CookieWrite[] = [];

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const ip = getClientIp(request);
    await assertWithinRateLimit({
      key: `auth:signup:ip:${ip}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
      );
    }
    const { email, password } = parsed.data;

    if (await isPasswordBreached(password)) {
      throw new ValidationError(
        "That password has appeared in a known data breach. Choose a different one.",
      );
    }

    // `siteConfig.url` rather than the raw env var: an unset
    // NEXT_PUBLIC_SITE_URL would otherwise build a relative
    // "/api/auth/confirm", which Supabase rejects as a redirect target and
    // which would silently cost every customer their confirmation link.
    // The confirmation email links to /api/auth/confirm (token_hash flow),
    // not /api/auth/callback (PKCE) — see that route for why.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${siteConfig.url}/api/auth/confirm` },
    });

    // The `error` here is NOT discarded. Doing so turned a failed
    // confirmation-email send into a 200 "link is on its way" — R12's
    // exact silent-failure signature. See `classifySignupResult()`.
    const outcome = classifySignupResult(error, data.user !== null);
    switch (outcome.kind) {
      case "validation":
        throw new ValidationError(outcome.message);
      case "rate-limited":
        throw new RateLimitError(outcome.message);
      case "operational":
        // Generic 500 to the caller, full reason to the server log.
        throw new Error(outcome.reason, { cause: error });
      case "generic-success":
        break;
    }

    // A confirmed session on signUp only happens when email confirmations
    // are disabled for the project — creating the profile row now keeps
    // that path idempotent-and-complete too (task 8). When confirmation is
    // required (the launch configuration, per R12), there is no session
    // yet; the row is created on first authenticated request instead
    // (see src/server/auth/session.ts).
    if (data.user && data.session) {
      await getOrCreateAppUser({ id: data.user.id, email });
    }

    return applyCookies(
      NextResponse.json({ message: GENERIC_SIGNUP_MESSAGE }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("auth/signup", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
