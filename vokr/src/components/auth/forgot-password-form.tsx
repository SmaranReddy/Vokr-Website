"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { ErrorResponseBody } from "@/lib/errors";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json()) as
        { message: string } | ErrorResponseBody;

      if (!response.ok) {
        setIsError(true);
        setMessage(
          "error" in body ? body.error.message : "Something went wrong.",
        );
      } else {
        setMessage("message" in body ? body.message : "Check your email.");
      }
    } catch {
      setIsError(true);
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setStatus("done");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-foreground/15 bg-background px-3 py-2 text-base"
        />
      </label>
      <Button
        type="submit"
        disabled={status === "submitting"}
        className="w-full"
      >
        {status === "submitting" ? "Sending…" : "Send reset link"}
      </Button>
      {message ? (
        <p
          role="status"
          className={`text-sm ${isError ? "text-red-600" : "text-foreground/70"}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
