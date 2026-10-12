import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
import { logServerError } from "@/lib/log";
import {
  applyCookies,
  createRouteSupabaseClient,
  type CookieWrite,
} from "@/server/auth/supabase";

export async function POST(request: NextRequest) {
  let cookiesToSet: CookieWrite[] = [];

  try {
    const client = createRouteSupabaseClient(request);
    cookiesToSet = client.cookiesToSet;

    await client.supabase.auth.signOut();
    return applyCookies(
      NextResponse.json({ message: "Signed out." }),
      cookiesToSet,
    );
  } catch (error) {
    const { status, body, requestId } = toErrorResponse(error);
    logServerError("auth/signout", requestId, error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
