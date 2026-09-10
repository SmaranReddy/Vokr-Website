"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

/** The legacy footer's `.footer-signup-row` (`onsubmit="return false;"`), bound to `/api/marketing/newsletter`. */
export function NewsletterForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = (new FormData(form).get("email") as string) ?? "";

    setStatus("submitting");
    try {
      const response = await fetch("/api/marketing/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: { message: string };
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error?.message ?? "Something went wrong.");
        return;
      }
      setStatus("success");
      setMessage(data.message ?? "You're on the list.");
      form.reset();
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <div>
      {/* `.footer-signup-row` stacks the field above the button below 541px. */}
      <form onSubmit={onSubmit} className="flex flex-col gap-2 narrow:flex-row">
        <label htmlFor="footer-newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="footer-newsletter-email"
          name="email"
          type="email"
          required
          placeholder="Email address"
          disabled={status === "submitting"}
          className="min-w-0 flex-1 border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="shrink-0 bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-colors hover:opacity-90 disabled:opacity-60"
        >
          Sign Up
        </button>
      </form>
      {message && (
        <p
          role="status"
          className={`mt-2 text-xs ${status === "error" ? "text-red-400" : "text-white/70"}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
