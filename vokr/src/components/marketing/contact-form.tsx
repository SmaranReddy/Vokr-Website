"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

/** `support-contact.html`'s form (three `onsubmit="return false;"` fieldsets in the legacy, consolidated to one bound to `/api/marketing/contact`) — Phase 4 task 10. */
export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus("submitting");
    try {
      const response = await fetch("/api/marketing/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          orderNumber: data.get("orderNumber") || undefined,
          message: data.get("message"),
        }),
      });
      const body = (await response.json()) as {
        message?: string;
        error?: { message: string };
      };
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error?.message ?? "Something went wrong.");
        return;
      }
      setStatus("success");
      setMessage(body.message ?? "Thanks — we'll get back to you soon.");
      form.reset();
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="contact-name" className="sr-only">
          Your name
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          placeholder="Your name"
          className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-email" className="sr-only">
            Email address
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            placeholder="Email address"
            className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
        </div>
        <div>
          <label htmlFor="contact-order-number" className="sr-only">
            Order number (optional)
          </label>
          <input
            id="contact-order-number"
            name="orderNumber"
            type="text"
            placeholder="Order number (optional)"
            className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
          />
        </div>
      </div>
      <div>
        <label htmlFor="contact-message" className="sr-only">
          How can we help?
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={4}
          placeholder="How can we help?"
          className="w-full resize-y border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={status === "submitting"}
        className="bg-foreground px-6 py-3 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-60"
      >
        Send Message
      </button>
      {message && (
        <p
          role="status"
          className={`text-sm ${status === "error" ? "text-red-600" : "text-muted"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
