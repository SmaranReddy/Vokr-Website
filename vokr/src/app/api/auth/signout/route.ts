import { NextResponse, type NextRequest } from "next/server";

import { toErrorResponse } from "@/lib/errors";
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
    const { status, body } = toErrorResponse(error);
    return applyCookies(NextResponse.json(body, { status }), cookiesToSet);
  }
}
