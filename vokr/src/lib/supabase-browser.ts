import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env-client";

/**
 * Browser-only Supabase client. Used for the two auth actions that must
 * originate from the customer's own browser rather than our API routes:
 * (1) the Google OAuth redirect (`signInWithOAuth`), which has to send the
 * browser to Google directly, and (2) reading/updating the temporary
 * recovery session a password-reset link establishes
 * (`auth.updateUser({ password })`) — that session lives only in the
 * browser that followed the email link, never in our server.
 */
export function createSupabaseBrowserClient() {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    );
  }
  return createBrowserClient(url, anonKey);
}
