"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Must run in the browser, not through our API — `signInWithOAuth`
 * navigates the browser itself to Google's consent screen, which a JSON
 * API response cannot do.
 */
export function GoogleSignInButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsPending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
      if (oauthError) {
        setError("Could not start Google sign-in. Please try again.");
        setIsPending(false);
      }
      // On success the browser is redirected away by Supabase — no further
      // state update needed here.
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={handleClick}
        disabled={isPending}
      >
        Continue with Google
      </Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
