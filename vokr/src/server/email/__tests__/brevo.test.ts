import { describe, expect, it, vi } from "vitest";

import { BREVO_SEND_URL, createBrevoEmailClient, EmailSendError, ORDER_EMAIL_SENDER } from "../brevo";

const EMAIL = { to: "buyer@example.com", subject: "Your Vokr order VK-10001", text: "t", html: "<p>h</p>", idempotencyKey: "0199e3f0-row-id" };

function reply(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

describe("createBrevoEmailClient", () => {
  it("sends one request with sender, recipient, subject and both bodies; returns Brevo's messageId", async () => {
    const fetchImpl = vi.fn(async () => reply(201, { messageId: "<abc@smtp-relay.brevo.com>" }));
    const client = createBrevoEmailClient("xkeysib-test", { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.send(EMAIL)).resolves.toEqual({ messageId: "<abc@smtp-relay.brevo.com>" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BREVO_SEND_URL);
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    expect(JSON.parse(String(init.body))).toEqual({
      sender: ORDER_EMAIL_SENDER,
      to: [{ email: "buyer@example.com" }],
      replyTo: ORDER_EMAIL_SENDER,
      subject: EMAIL.subject,
      textContent: "t",
      htmlContent: "<p>h</p>",
      headers: { idempotencyKey: "0199e3f0-row-id" },
    });
  });

  it("401/403 (bad key, unverified sender) is an account-level failure, not retried", async () => {
    const fetchImpl = vi.fn(async () => reply(401, { code: "unauthorized" }));
    const client = createBrevoEmailClient("k", { fetchImpl: fetchImpl as unknown as typeof fetch, retryPauseMs: 0 });

    const error = await client.send(EMAIL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).kind).toBe("account");
    expect((error as EmailSendError).retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("another 4xx is a problem with this message, not retried", async () => {
    const fetchImpl = vi.fn(async () => reply(400, { code: "invalid_parameter" }));
    const client = createBrevoEmailClient("k", { fetchImpl: fetchImpl as unknown as typeof fetch, retryPauseMs: 0 });

    const error = await client.send(EMAIL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).kind).toBe("message");
    expect((error as EmailSendError).retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("a retry reuses the idempotency key; Brevo's duplicate reply means it was already sent", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up")) // the first send may have been accepted
      .mockResolvedValueOnce(reply(400, { code: "duplicate_parameter", message: "idempotency key already used" }));
    const client = createBrevoEmailClient("k", { fetchImpl: fetchImpl as unknown as typeof fetch, retryPauseMs: 0 });

    await expect(client.send(EMAIL)).resolves.toEqual({ messageId: "idempotent:0199e3f0-row-id" });
    const keys = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).headers.idempotencyKey);
    expect(keys).toEqual(["0199e3f0-row-id", "0199e3f0-row-id"]);
  });

  it("a 5xx or 429 is retried once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply(503, "unavailable"))
      .mockResolvedValueOnce(reply(201, { messageId: "m2" }));
    const client = createBrevoEmailClient("k", { fetchImpl: fetchImpl as unknown as typeof fetch, retryPauseMs: 0 });
    await expect(client.send(EMAIL)).resolves.toEqual({ messageId: "m2" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const throttled = vi.fn(async () => reply(429, "slow down"));
    const second = createBrevoEmailClient("k", { fetchImpl: throttled as unknown as typeof fetch, retryPauseMs: 0 });
    const error = await second.send(EMAIL).catch((caught: unknown) => caught);
    expect((error as EmailSendError).retryable).toBe(true);
    expect(throttled).toHaveBeenCalledTimes(2);
  });

  it("a timeout is a retryable failure", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    const client = createBrevoEmailClient("k", { fetchImpl: hang as unknown as typeof fetch, timeoutMs: 10, retryPauseMs: 0 });
    const error = await client.send(EMAIL).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).message).toMatch(/timed out/);
    expect((error as EmailSendError).retryable).toBe(true);
  });

  it("accepted without a messageId is a permanent failure", async () => {
    const fetchImpl = vi.fn(async () => reply(201, {}));
    const client = createBrevoEmailClient("k", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = await client.send(EMAIL).catch((caught: unknown) => caught);
    expect((error as EmailSendError).retryable).toBe(false);
  });
});
