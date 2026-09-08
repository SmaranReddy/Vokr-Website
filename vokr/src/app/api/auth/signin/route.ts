import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  UnauthorizedError,
  ValidationError,
  toErrorResponse,
} from "@/lib/errors";
import { completeSignIn } from "@/server/auth/complete-sign-in";
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
    password: z.string().min(1).max(128),
  })
  .strict();

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const client = createRouteSupabaseClient(request);
    const { supabase } = client;
    cookiesToSet = client.cookiesToSet;

    const ip = getClientIp(request);
    // Two independent buckets: per-IP stops one attacker hammering many
    // accounts, per-email stops a distributed attack targeting one
    // account. Both are needed (plan §5 Phase 3, task 11).
    await assertWithinRateLimit({
      key: `auth:signin:ip:${ip}`,
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError("Invalid request body.");
    }
    const { email, password } = parsed.data;

    await assertWithinRateLimit({
      key: `auth:signin:email:${email.toLowerCase()}`,
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      // Same message whether the account doesn't exist or the password is
      // wrong — no user enumeration through message differences.
      throw new UnauthorizedError("Invalid email or password.");
    }

    await completeSignIn({
      request,
      cookiesToSet,
      userId: data.user.id,
      userEmail: data.user.email ?? email,
    });

    return applyCookies(
      NextResponse.json({ userId: data.user.id }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
