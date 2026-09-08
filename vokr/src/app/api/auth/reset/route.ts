import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { clientEnv } from "@/lib/env";
import { ValidationError, toErrorResponse } from "@/lib/errors";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";
import { getClientIp } from "@/server/net/client-ip";
import { assertWithinRateLimit } from "@/server/rate-limit";

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

    await assertWithinRateLimit({
      key: `auth:reset:email:${email.toLowerCase()}`,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });

    const siteUrl = clientEnv.NEXT_PUBLIC_SITE_URL ?? "";
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    return applyCookies(
      NextResponse.json({ message: GENERIC_RESET_MESSAGE }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
