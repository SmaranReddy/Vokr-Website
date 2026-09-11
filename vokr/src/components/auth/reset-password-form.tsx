"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * This page is the target of the email link Supabase's
 * `resetPasswordForEmail()` sends. The link carries a one-time
 * `?code=...` that must be exchanged for a temporary recovery session
 * *in this browser* before `auth.updateUser({ password })` is allowed —
 * that exchange, and the password update itself, both have to happen
 * client-side, since the recovery session lives only in this tab.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [code] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("code"),
  );
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(code === null);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (exchangeError) {
          setLinkError(true);
        } else {
          setReady(true);
        }
      });
  }, [code]);

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
