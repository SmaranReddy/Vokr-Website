/**
 * Brevo transactional email (plan §5 Phase 11, task 1): a typed client
 * with a timeout, a bounded retry, idempotency and classified failures.
 * Injectable (`fetchImpl`) so the outbox is tested without a network.
 *
 * - **Idempotency.** Every send carries `headers.idempotencyKey` (Brevo's
 *   body-level key; a repeat within its window — 15 min per the 2021
 *   changelog, 30 min per current docs — is refused with
 *   `duplicate_parameter` instead of being sent twice). The outbox uses the
 *   `email_log` row id, so a retry after a timeout, or a re-queued crashed
 *   send, never duplicates an email. A `duplicate_parameter` reply means
 *   "already sent" and is treated as success. Verified against Brevo's
 *   documentation, not yet against a live account (no key).
 * - **Retried:** network failures, timeouts, 429 and 5xx — once, after a
 *   short pause, with the same idempotency key.
 * - **Account-level failures** (401/403: bad key, unverified sender,
 *   blocked IP) are flagged so the outbox stops the batch instead of
 *   failing every pending email.
 * - **Anything else** (another 4xx) is a problem with this one message.
 */

export const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
/** Short: the whole email step runs inside a 90 s Scheduler deadline. */
export const SEND_TIMEOUT_MS = 5_000;
const RETRY_PAUSE_MS = 500;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable per logical email (the outbox row id): repeats are deduplicated by Brevo. */
  idempotencyKey: string;
}

export interface TransactionalEmailClient {
  /** Brevo's message id for the accepted email. Throws {@link EmailSendError} otherwise. */
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export type EmailFailureKind = "message" | "account";

export class EmailSendError extends Error {
  constructor(
    message: string,
    /** `true` when trying again later may succeed (network, timeout, 429, 5xx). */
    readonly retryable: boolean,
    /** `account`: the key or sender is wrong — no email can be sent until a person fixes it. */
    readonly kind: EmailFailureKind = "message",
  ) {
    super(message);
  }
}

/** The sender every order email comes from — the address Brevo already relays the contact form through. */
export const ORDER_EMAIL_SENDER = { name: "Vokr", email: "support@vokr.shop" } as const;

class AlreadySent extends Error {}

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
          headers: { idempotencyKey: email.idempotencyKey },
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
    if (response.status === 400 && detail.includes("duplicate_parameter")) throw new AlreadySent();
    if (response.status === 401 || response.status === 403) {
      throw new EmailSendError(`Brevo ${response.status}: ${detail}`, false, "account");
    }
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailSendError(`Brevo ${response.status}: ${detail}`, retryable);
  }

  async function attemptOrAlreadySent(email: OutgoingEmail): Promise<{ messageId: string }> {
    try {
      return await attempt(email);
    } catch (error) {
      // An earlier attempt with this key was accepted: the email went out once.
      if (error instanceof AlreadySent) return { messageId: `idempotent:${email.idempotencyKey}` };
      throw error;
    }
  }

  return {
    async send(email) {
      try {
        return await attemptOrAlreadySent(email);
      } catch (error) {
        if (!(error instanceof EmailSendError) || !error.retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
        return attemptOrAlreadySent(email);
      }
    },
  };
}
