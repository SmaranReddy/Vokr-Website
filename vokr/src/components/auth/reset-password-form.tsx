"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * The page a verified recovery link lands on.
 *
 * `GET /api/auth/reset/confirm` has already redeemed the link's
 * `token_hash` with `verifyOtp()` on the server and written the recovery
 * session as cookies, so all this component does is confirm a session
 * exists and collect the new password.
 *
 * It used to call `exchangeCodeForSession(code)` here instead. That needed
 * the PKCE code-verifier cookie written by the response to
 * `POST /api/auth/reset`, which exists only in the browser that submitted
 * the forgot-password form — so opening the link in a private window, a
 * second browser, a phone or webmail always failed with the "invalid or
 * has expired" message below. See Vokr-Implementation-Plan.md, Phase 3
 * defect log.
 *
 * `updateUser()` stays client-side, as before: `@supabase/ssr` does not
 * mark session cookies `HttpOnly`, so the browser client reads the
 * server-established session from `document.cookie`.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  // A rejected link is redirected here with `?error=link`. Read through
  // `useSearchParams` rather than `window.location` so the value is stable
  // across the server prerender and hydration; trusted over the session
  // check below, so a visitor who already holds a session is never shown a
  // password form off a link that failed. Requires the Suspense boundary
  // this component is rendered inside.
  const rejected = useSearchParams().get("error") === "link";
  const [ready, setReady] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const linkError = rejected || sessionMissing;
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rejected) {
      return;
    }

    let active = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data, error: sessionError }) => {
      if (!active) {
        return;
      }
      if (sessionError || !data.user) {
        setSessionMissing(true);
      } else {
        setReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [rejected]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(
        "Could not update your password. Request a new reset link and try again.",
      );
      setStatus("idle");
      return;
    }

    // Drop the recovery session before leaving: it was minted from an
    // emailed link, so it should not outlive the reset it was issued for.
    // Sign-out goes through the API route that owns session cookies.
    await fetch("/api/auth/signout", { method: "POST" });

    setStatus("done");
    router.push("/sign-in");
  }

  if (linkError) {
    return (
      <p className="text-sm text-red-600">
        This reset link is invalid or has expired. Request a new one from the
        forgot-password page.
      </p>
    );
  }

  if (!ready) {
    return <p className="text-sm text-foreground/70">Verifying your link…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-md border border-foreground/15 bg-background px-3 py-2 text-base"
        />
      </label>
      <Button
        type="submit"
        disabled={status === "submitting"}
        className="w-full"
      >
        {status === "submitting" ? "Updating…" : "Update password"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
