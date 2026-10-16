/**
 * Brevo transactional email (plan §5 Phase 11, task 1): a typed client
 * with a timeout, a bounded retry and structured outcomes. Injectable
 * (`fetchImpl`) so the outbox is tested without a network.
 *
 * Retried: network failures, timeouts, 429 and 5xx — once, after a short
 * pause. Not retried: any other 4xx (a bad key, an unverified sender, a
 * malformed request), which is a configuration problem a retry cannot fix.
 */

export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
export const SEND_TIMEOUT_MS = 10_000;
const RETRY_PAUSE_MS = 500;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface TransactionalEmailClient {
  /** Brevo's message id for the accepted email. Throws {@link EmailSendError} otherwise. */
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    /** `true` when trying again later may succeed (network, timeout, 429, 5xx). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** The sender every order email comes from — the address Brevo already relays the contact form through. */
export const ORDER_EMAIL_SENDER = { name: "Vokr", email: "support@vokr.shop" } as const;

export function createBrevoEmailClient(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; retryPauseMs?: number } = {},
): TransactionalEmailClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  const retryPauseMs = options.retryPauseMs ?? RETRY_PAUSE_MS;

  async function attempt(email: OutgoingEmail): Promise<{ messageId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(BREVO_SEND_URL, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: ORDER_EMAIL_SENDER,
          to: [{ email: email.to }],
          replyTo: ORDER_EMAIL_SENDER,
          subject: email.subject,
          textContent: email.text,
          htmlContent: email.html,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : (error as Error).message;
      throw new EmailSendError(`Brevo unreachable: ${reason}`, true);
    } finally {
      clearTimeout(timer);
    }
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { messageId?: unknown };
      if (typeof body.messageId !== "string" || body.messageId.length === 0) {
        throw new EmailSendError("Brevo accepted the email but returned no messageId", false);
      }
      return { messageId: body.messageId };
    }
    // Brevo's error body names the problem (e.g. unauthorised sender); it carries no recipient data.
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailSendError(`Brevo ${response.status}: ${detail}`, retryable);
  }

  return {
    async send(email) {
      try {
        return await attempt(email);
      } catch (error) {
        if (!(error instanceof EmailSendError) || !error.retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
        return attempt(email);
      }
    },
  };
}
