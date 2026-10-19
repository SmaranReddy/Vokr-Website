import { AppError, InternalError } from "@/lib/errors";
import { requireServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/log";

/**
 * Minimal Brevo REST client for the two forms Phase 4 task 10 makes real:
 * the footer newsletter signup and the support contact form. Brevo is
 * already this project's transactional-email provider (Supabase SMTP,
 * Phase 3) — `BREVO_API_KEY` was reserved in `env.ts` from Phase 1 for
 * exactly this kind of direct API call. No database row is written for
 * either form (Phase 4's Database Impact is "None" — Brevo is the system
 * of record), so a missing/rejected key surfaces as a real error rather
 * than a silently-swallowed success.
 *
 * Every Brevo failure is a {@link FormDeliveryError} (a 500 to the visitor,
 * with the same message as before) carrying a sanitized reason; the route
 * logs it once under {@link FORM_DELIVERY_FAILED_TAG}, which the
 * `vokr_form_delivery_failed` metric counts (docs/infrastructure/alerting.md).
 */

const BREVO_API_BASE = "https://api.brevo.com/v3";

/**
 * A visitor is waiting on the form, and Cloud Run would otherwise hold the
 * request open up to its 300 s deadline. Longer than the order-email
 * client's 5 s, which retries inside a 90 s Scheduler budget: this one does
 * not retry — the contact send has no idempotency key, so a retry could put
 * the same message in the support inbox twice.
 */
export const FORM_TIMEOUT_MS = 8_000;

export const FORM_DELIVERY_FAILED_TAG = "FORM_DELIVERY_FAILED";

export type FormName = "newsletter" | "contact";
export type FormFailureReason = "not_configured" | "timeout" | "network" | "rejected";

export class FormDeliveryError extends InternalError {
  constructor(
    message: string,
    readonly reason: FormFailureReason,
    /** Brevo's HTTP status, for `rejected`. */
    readonly providerStatus?: number,
    /** Brevo's machine error code (e.g. `unauthorized`), allowlisted — never its free-text message. */
    readonly providerCode?: string,
  ) {
    super(message);
  }
}

export interface BrevoFormOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Brevo error bodies are `{ code, message }`; the message can echo what was
// submitted (an email address), so only a code of this shape is kept.
const PROVIDER_CODE = /^[a-z_]{1,64}$/;

function providerCodeOf(body: string): string | undefined {
  try {
    const code = (JSON.parse(body) as { code?: unknown } | null)?.code;
    return typeof code === "string" && PROVIDER_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function requireBrevoApiKey(failureMessage: string): string {
  const { BREVO_API_KEY } = requireServerEnv();
  if (!BREVO_API_KEY) throw new FormDeliveryError(failureMessage, "not_configured");
  return BREVO_API_KEY;
}

/**
 * One POST to Brevo, bounded by the timeout end to end (the body is read
 * inside it too). Resolves with the status and body text of any HTTP
 * response; a network failure or timeout throws {@link FormDeliveryError}.
 */
async function postToBrevo(
  path: string,
  payload: unknown,
  failureMessage: string,
  options: BrevoFormOptions,
): Promise<{ ok: boolean; status: number; body: string }> {
  const apiKey = requireBrevoApiKey(failureMessage);
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FORM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${BREVO_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch {
    // The underlying error is dropped on purpose: its message can carry the
    // request URL or socket details and adds nothing the reason doesn't say.
    throw new FormDeliveryError(failureMessage, controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

const NEWSLETTER_FAILED = "Could not complete the newsletter signup.";
const CONTACT_FAILED = "Could not send your message. Please try again.";

/**
 * The newsletter call is an upsert (`updateEnabled: true`), so repeating it
 * cannot create a second contact: it gets one retry for a transient failure
 * (timeout, network, 429, 5xx), never for a definite refusal (other 4xx).
 * Two shorter attempts plus the pause stay inside the contact form's single
 * {@link FORM_TIMEOUT_MS} budget, so the visitor waits no longer.
 */
export const NEWSLETTER_ATTEMPTS = 2;
export const NEWSLETTER_ATTEMPT_TIMEOUT_MS = 3_800;
export const NEWSLETTER_RETRY_DELAY_MS = 300;

function isTransient(error: FormDeliveryError): boolean {
  if (error.reason === "timeout" || error.reason === "network") return true;
  const status = error.providerStatus ?? 0;
  return error.reason === "rejected" && (status === 429 || status >= 500);
}

/** Adds (or updates) a contact on the Brevo list backing the footer signup form. */
export async function subscribeToNewsletter(email: string, options: BrevoFormOptions = {}): Promise<void> {
  const attemptOptions = { ...options, timeoutMs: options.timeoutMs ?? NEWSLETTER_ATTEMPT_TIMEOUT_MS };
  for (let attempt = 1; ; attempt++) {
    try {
      return await newsletterAttempt(email, attemptOptions);
    } catch (error) {
      if (!(error instanceof FormDeliveryError) || !isTransient(error) || attempt >= NEWSLETTER_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, NEWSLETTER_RETRY_DELAY_MS));
    }
  }
}

async function newsletterAttempt(email: string, options: BrevoFormOptions): Promise<void> {
  const response = await postToBrevo("/contacts", { email, updateEnabled: true }, NEWSLETTER_FAILED, options);

  // 201/204 = created/updated, 400 duplicate_parameter = already subscribed — all success.
  if (response.ok) return;
  const code = providerCodeOf(response.body);
  if (response.status === 400 && code === "duplicate_parameter") return;

  throw new FormDeliveryError(NEWSLETTER_FAILED, "rejected", response.status, code);
}

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

/** Relays the support-contact form as a transactional email to the support inbox. */
export async function sendContactMessage(input: ContactMessage, options: BrevoFormOptions = {}): Promise<void> {
  const response = await postToBrevo(
    "/smtp/email",
    {
      sender: { name: "Vokr Support Form", email: "support@vokr.shop" },
      to: [{ email: "support@vokr.shop" }],
      replyTo: { email: input.email, name: input.name },
      subject: `Contact form: ${input.name}`,
      textContent: input.message,
    },
    CONTACT_FAILED,
    options,
  );

  if (response.ok) return;
  throw new FormDeliveryError(CONTACT_FAILED, "rejected", response.status, providerCodeOf(response.body));
}

/**
 * The log call for both form routes. A form that could not be delivered —
 * a Brevo failure, or anything unexpected — is one `error` line,
 * `[marketing/<form>] FORM_DELIVERY_FAILED {json}` (a tag inside a text
 * line, so the metric's `textPayload` filter matches), holding only the
 * reason, Brevo status, allowlisted code and request id: never the key,
 * headers, the visitor's name/email/message or Brevo's response text.
 * Expected refusals (validation, rate limit) are not delivery failures and
 * keep `logServerError`'s untagged warn line.
 */
export function logFormError(form: FormName, requestId: string, error: unknown): void {
  const scope = `marketing/${form}`;
  if (error instanceof FormDeliveryError) {
    const detail = {
      form,
      reason: error.reason,
      ...(error.providerStatus !== undefined ? { status: error.providerStatus } : {}),
      ...(error.providerCode !== undefined ? { code: error.providerCode } : {}),
      requestId,
    };
    console.error(`[${scope}] ${FORM_DELIVERY_FAILED_TAG} ${JSON.stringify(detail)}`);
    return;
  }
  if (!(error instanceof AppError)) {
    console.error(`[${scope}] ${FORM_DELIVERY_FAILED_TAG} ${JSON.stringify({ form, reason: "unexpected", requestId })}`);
  }
  logServerError(scope, requestId, error);
}
