import { NextResponse, type NextRequest } from "next/server";

import { ORDERING_ENABLED } from "@/config/commerce";
import { applyCookies, createRouteSupabaseClient } from "@/server/auth/supabase";

/**
 * `GET /account` — where the header's account icon points once ordering
 * opens (owner decision, 15 Oct 2026; §2A.6): a signed-in customer goes to
 * their orders, anyone else to sign-in. Decided on the server, so the
 * header needs no client-side auth state and never flickers. Reads the
 * Supabase session only — it never creates a guest session.
 */
export async function GET(request: NextRequest) {
  const signIn = new URL("/sign-in", request.url);
  if (!ORDERING_ENABLED) return NextResponse.redirect(signIn, 307);
  try {
    const { supabase, cookiesToSet } = createRouteSupabaseClient(request);
    const { data, error } = await supabase.auth.getUser();
    const target = !error && data.user ? new URL("/orders", request.url) : signIn;
    return applyCookies(NextResponse.redirect(target, 307), cookiesToSet);
  } catch {
    return NextResponse.redirect(signIn, 307);
  }
}
