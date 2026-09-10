import { InternalError } from "@/lib/errors";
import { requireServerEnv } from "@/lib/env";

/**
 * Minimal Brevo REST client for the two forms Phase 4 task 10 makes real:
 * the footer newsletter signup and the support contact form. Brevo is
 * already this project's transactional-email provider (Supabase SMTP,
 * Phase 3) — `BREVO_API_KEY` was reserved in `env.ts` from Phase 1 for
 * exactly this kind of direct API call. No database row is written for
 * either form (Phase 4's Database Impact is "None" — Brevo is the system
 * of record), so a missing/rejected key surfaces as a real error rather
 * than a silently-swallowed success.
 */

const BREVO_API_BASE = "https://api.brevo.com/v3";

function requireBrevoApiKey(): string {
  const { BREVO_API_KEY } = requireServerEnv();
  if (!BREVO_API_KEY) {
    throw new InternalError(
      "Newsletter/contact delivery is not configured.",
      { cause: new Error("BREVO_API_KEY is not set") },
    );
  }
  return BREVO_API_KEY;
}

/** Adds (or updates) a contact on the Brevo list backing the footer signup form. */
export async function subscribeToNewsletter(email: string): Promise<void> {
  const apiKey = requireBrevoApiKey();

  const response = await fetch(`${BREVO_API_BASE}/contacts`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email, updateEnabled: true }),
  });

  // 204 = created, 400 duplicate_parameter = already subscribed — both success.
  if (response.ok || response.status === 204) return;
  const body = await response.text();
  if (response.status === 400 && body.includes("duplicate_parameter")) return;

  throw new InternalError("Could not complete the newsletter signup.", {
    cause: new Error(`Brevo contacts API ${response.status}: ${body}`),
  });
}

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

/** Relays the support-contact form as a transactional email to the support inbox. */
export async function sendContactMessage(
  input: ContactMessage,
): Promise<void> {
  const apiKey = requireBrevoApiKey();

  const response = await fetch(`${BREVO_API_BASE}/smtp/email`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Vokr Support Form", email: "support@vokr.shop" },
      to: [{ email: "support@vokr.shop" }],
      replyTo: { email: input.email, name: input.name },
      subject: `Contact form: ${input.name}`,
      textContent: input.message,
    }),
  });

  if (response.ok) return;
  const body = await response.text();
  throw new InternalError("Could not send your message. Please try again.", {
    cause: new Error(`Brevo smtp/email API ${response.status}: ${body}`),
  });
}
