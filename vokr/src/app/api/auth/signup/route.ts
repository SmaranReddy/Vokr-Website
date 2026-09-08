import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { clientEnv } from "@/lib/env";
import { ValidationError, toErrorResponse } from "@/lib/errors";
import { getOrCreateAppUser } from "@/server/auth/app-user";
import {
  MIN_PASSWORD_LENGTH,
  isPasswordBreached,
} from "@/server/auth/password";
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
 * rather than re-implementing: every successful call gets this same
 * message, and the actual Supabase result is not inspected beyond
 * unexpected failures (network, config), which fall through to the
 * generic 500 in the catch block below.
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

    const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL ?? "";
    const { data } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${siteUrl}/api/auth/callback` },
    });

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
    const { status, body } = toErrorResponse(error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
