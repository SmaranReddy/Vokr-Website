import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The newsletter/contact Brevo client: every outcome is either a real
 * success or a {@link FormDeliveryError} with a sanitized reason — never a
 * silent success, never a hang, never a log line carrying the key or what
 * the visitor typed. `fetch` is always a mock: no request reaches Brevo.
 */

const env = { BREVO_API_KEY: "xkeysib-unit-test-secret" as string | undefined };
vi.mock("@/lib/env", () => ({ requireServerEnv: () => env }));

const {
  BLOCKLIST_MAX_PAGES,
  BLOCKLIST_PAGE_SIZE,
  FORM_DELIVERY_FAILED_TAG,
  FORM_TIMEOUT_MS,
  FormDeliveryError,
  NEWSLETTER_ATTEMPTS,
  NEWSLETTER_ATTEMPT_TIMEOUT_MS,
  NEWSLETTER_RETRY_DELAY_MS,
  logFormError,
  sendContactMessage,
  subscribeToNewsletter,
} = await import("../brevo");
const { RateLimitError, ValidationError } = await import("@/lib/errors");

const VISITOR = { name: "Asha Visitor", email: "asha.visitor@example.com", message: "My order VK-10001 has a torn insole." };
// Brevo's free-text message can echo the submission; it must never reach a log line.
const ECHOING_BODY = JSON.stringify({ code: "unauthorized", message: "Key not found for asha.visitor@example.com" });

function reply(status: number, body = "") {
  return new Response(status === 204 ? null : body, { status });
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** Never answers; rejects only when the caller's signal aborts — like a stalled socket. */
function hangingFetch() {
  return mockFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FormDeliveryError);
  return error as InstanceType<typeof FormDeliveryError>;
}

beforeEach(() => {
  env.BREVO_API_KEY = "xkeysib-unit-test-secret";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("subscribeToNewsletter", () => {
  it("posts the email to /contacts with the key header and an abort signal", async () => {
    const fetchImpl = mockFetch(async () => reply(201, JSON.stringify({ id: 42 })));
    await expect(subscribeToNewsletter(VISITOR.email, { fetchImpl })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-unit-test-secret");
    expect(JSON.parse(String(init.body))).toEqual({ email: VISITOR.email, updateEnabled: true });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("204 (contact updated) is success", async () => {
    await expect(subscribeToNewsletter(VISITOR.email, { fetchImpl: mockFetch(async () => reply(204)) })).resolves.toBeUndefined();
  });

  it("400 duplicate_parameter (already subscribed) is success", async () => {
    const fetchImpl = mockFetch(async () => reply(400, JSON.stringify({ code: "duplicate_parameter", message: "Contact already exist" })));
    await expect(subscribeToNewsletter(VISITOR.email, { fetchImpl })).resolves.toBeUndefined();
  });

  it("another 400 is a rejection, with Brevo's code kept and its message dropped", async () => {
    const fetchImpl = mockFetch(async () => reply(400, JSON.stringify({ code: "invalid_parameter", message: `bad ${VISITOR.email}` })));
    const error = await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }));
    expect(error).toMatchObject({ reason: "rejected", providerStatus: 400, providerCode: "invalid_parameter", status: 500 });
    expect(error.message).toBe("Could not complete the newsletter signup.");
    expect(JSON.stringify(error)).not.toContain(VISITOR.email);
  });

  it("401 (bad key) and 5xx are rejections; a non-JSON or odd-shaped code is not kept", async () => {
    const unauthorized = await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl: mockFetch(async () => reply(401, ECHOING_BODY)) }));
    expect(unauthorized).toMatchObject({ reason: "rejected", providerStatus: 401, providerCode: "unauthorized" });

    const html = await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl: mockFetch(async () => reply(502, "<html>Bad Gateway</html>")) }));
    expect(html).toMatchObject({ reason: "rejected", providerStatus: 502, providerCode: undefined });

    const odd = await failure(
      subscribeToNewsletter(VISITOR.email, { fetchImpl: mockFetch(async () => reply(500, JSON.stringify({ code: "Not A Code <x@y.z>" }))) }),
    );
    expect(odd.providerCode).toBeUndefined();
  });

  it("a stalled request times out instead of hanging", async () => {
    vi.useFakeTimers();
    const pending = failure(subscribeToNewsletter(VISITOR.email, { fetchImpl: hangingFetch() }));
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    expect(await pending).toMatchObject({ reason: "timeout", providerStatus: undefined });
  });

  it("the default timeout is bounded", () => {
    expect(FORM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FORM_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("the timeout also covers a response whose body stalls after the headers", async () => {
    vi.useFakeTimers();
    const fetchImpl = mockFetch(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    });
    const pending = failure(subscribeToNewsletter(VISITOR.email, { fetchImpl, timeoutMs: 1_000 }));
    // Two attempts (a stall is transient) and the pause between them.
    await vi.advanceTimersByTimeAsync(2 * 1_000 + NEWSLETTER_RETRY_DELAY_MS);
    expect((await pending).reason).toBe("timeout");
  });

  it("a network failure is `network`, and the underlying error (URL, socket detail) is not carried", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED api.brevo.com");
    });
    const error = await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }));
    expect(error.reason).toBe("network");
    expect(error.cause).toBeUndefined();
  });

  it("a transient failure (503, 429, timeout, network) is retried once, and a recovery is success", async () => {
    for (const first of [() => reply(503), () => reply(429), () => Promise.reject(new TypeError("fetch failed"))]) {
      let calls = 0;
      const fetchImpl = mockFetch(async () => (++calls === 1 ? first() : reply(201)));
      await expect(subscribeToNewsletter(VISITOR.email, { fetchImpl })).resolves.toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("a definite refusal (400, 401, 403) is not retried", async () => {
    for (const status of [400, 401, 403]) {
      const fetchImpl = mockFetch(async () => reply(status, JSON.stringify({ code: "invalid_parameter" })));
      expect((await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }))).providerStatus).toBe(status);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("gives up after the attempt cap, reporting the last failure", async () => {
    const fetchImpl = mockFetch(async () => reply(502));
    expect(await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }))).toMatchObject({ reason: "rejected", providerStatus: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(NEWSLETTER_ATTEMPTS);
  });

  it("all attempts together still fit the single-request budget the visitor waits for", async () => {
    expect(NEWSLETTER_ATTEMPTS).toBe(2);
    expect(NEWSLETTER_ATTEMPTS * NEWSLETTER_ATTEMPT_TIMEOUT_MS + NEWSLETTER_RETRY_DELAY_MS).toBeLessThanOrEqual(FORM_TIMEOUT_MS);
    vi.useFakeTimers();
    const fetchImpl = hangingFetch();
    const pending = failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }));
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    expect((await pending).reason).toBe("timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("no key is `not_configured` and makes no request", async () => {
    env.BREVO_API_KEY = undefined;
    const fetchImpl = mockFetch(async () => reply(201));
    expect((await failure(subscribeToNewsletter(VISITOR.email, { fetchImpl }))).reason).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendContactMessage", () => {
  const ACCEPTED = () => reply(201, JSON.stringify({ messageId: "<m@smtp-relay.brevo.com>" }));
  const EMPTY_BLOCKLIST = () => reply(200, JSON.stringify({ contacts: [], count: 0 }));

  /** Answers the blocklist GET with `blocklist` and the send POST with `send`. */
  function routedFetch(
    send: () => Response | Promise<Response>,
    blocklist: (url: string) => Response | Promise<Response> = EMPTY_BLOCKLIST,
  ) {
    return mockFetch(async (url) => (url.includes("/smtp/blockedContacts") ? blocklist(url) : send()));
  }
  const sends = (fetchImpl: ReturnType<typeof mockFetch>) =>
    fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/smtp/email")) as [string, RequestInit][];

  it("checks the blocklist, then relays the message to the support inbox with the visitor as reply-to", async () => {
    const fetchImpl = routedFetch(ACCEPTED);
    await expect(sendContactMessage(VISITOR, { fetchImpl })).resolves.toBeUndefined();

    const [blockUrl, blockInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(blockUrl).toBe("https://api.brevo.com/v3/smtp/blockedContacts?limit=100&offset=0");
    expect(blockInit.method).toBe("GET");
    expect(blockInit.body).toBeUndefined();
    expect((blockInit.headers as Record<string, string>)["api-key"]).toBe("xkeysib-unit-test-secret");

    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: "Vokr Support Form", email: "support@vokr.shop" },
      to: [{ email: "support@vokr.shop" }],
      replyTo: { email: VISITOR.email, name: VISITOR.name },
      subject: `Contact form: ${VISITOR.name}`,
      textContent: VISITOR.message,
    });
  });

  it("a blocklisted support inbox is `recipient_blocked` and no email is sent (Brevo would 2xx and drop it)", async () => {
    const fetchImpl = routedFetch(ACCEPTED, () =>
      reply(200, JSON.stringify({ contacts: [{ email: "Support@Vokr.shop", reason: { code: "hardBounce" } }], count: 1 })),
    );
    const error = await failure(sendContactMessage(VISITOR, { fetchImpl }));
    expect(error).toMatchObject({
      reason: "recipient_blocked",
      status: 500,
      message: "Could not send your message. Please try again.",
    });
    expect(sends(fetchImpl)).toHaveLength(0);
  });

  it("pages through the blocklist until it finds the inbox", async () => {
    const others = Array.from({ length: 100 }, (_, i) => ({ email: `bounced-${i}@example.com` }));
    const fetchImpl = routedFetch(ACCEPTED, (url) =>
      reply(
        200,
        JSON.stringify(
          url.includes("offset=0") ? { contacts: others, count: 101 } : { contacts: [{ email: "support@vokr.shop" }], count: 101 },
        ),
      ),
    );
    expect((await failure(sendContactMessage(VISITOR, { fetchImpl }))).reason).toBe("recipient_blocked");
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("offset=100");
    expect(sends(fetchImpl)).toHaveLength(0);
  });

  it("a blocklist longer than the cap fails open with a warn line that names no one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const others = Array.from({ length: BLOCKLIST_PAGE_SIZE }, (_, i) => ({ email: `bounced-${i}@example.com` }));
    const fetchImpl = routedFetch(ACCEPTED, () => reply(200, JSON.stringify({ contacts: others, count: 10_000 })));
    await expect(sendContactMessage(VISITOR, { fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(BLOCKLIST_MAX_PAGES + 1);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).not.toMatch(/@/);
  });

  it("an unreadable blocklist (HTTP error or non-JSON) fails, and no email is sent", async () => {
    for (const blocklist of [() => reply(401, ECHOING_BODY), () => reply(200, "<html>oops</html>")]) {
      const fetchImpl = routedFetch(ACCEPTED, blocklist);
      expect((await failure(sendContactMessage(VISITOR, { fetchImpl }))).reason).toBe("rejected");
      expect(sends(fetchImpl)).toHaveLength(0);
    }
  });

  it("a 2xx without a messageId is `unconfirmed`, never success", async () => {
    for (const body of ["", "{}", JSON.stringify({ messageId: "" }), "not json"]) {
      const fetchImpl = routedFetch(() => reply(201, body));
      expect(await failure(sendContactMessage(VISITOR, { fetchImpl }))).toMatchObject({
        reason: "unconfirmed",
        providerStatus: 201,
      });
    }
  });

  it("400 duplicate_parameter is NOT success for a contact message", async () => {
    const fetchImpl = routedFetch(() => reply(400, JSON.stringify({ code: "duplicate_parameter" })));
    expect(await failure(sendContactMessage(VISITOR, { fetchImpl }))).toMatchObject({ reason: "rejected", providerStatus: 400 });
  });

  it("rejection, timeout and network failure all fail with the visitor-facing message", async () => {
    const rejected = await failure(sendContactMessage(VISITOR, { fetchImpl: routedFetch(() => reply(403, ECHOING_BODY)) }));
    expect(rejected).toMatchObject({
      reason: "rejected",
      providerStatus: 403,
      message: "Could not send your message. Please try again.",
    });

    vi.useFakeTimers();
    const pending = failure(sendContactMessage(VISITOR, { fetchImpl: hangingFetch() }));
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    expect((await pending).reason).toBe("timeout");
    vi.useRealTimers();

    const network = await failure(
      sendContactMessage(VISITOR, { fetchImpl: routedFetch(() => Promise.reject(new Error("socket hang up"))) }),
    );
    expect(network.reason).toBe("network");
  });

  it("the blocklist read and the send share one timeout budget", async () => {
    vi.useFakeTimers();
    const hang = hangingFetch();
    const fetchImpl = mockFetch(async (url, init) =>
      url.includes("/smtp/blockedContacts")
        ? new Promise<Response>((resolve) => setTimeout(() => resolve(EMPTY_BLOCKLIST()), FORM_TIMEOUT_MS - 1_000))
        : hang(url, init),
    );
    let settled = false;
    const pending = failure(sendContactMessage(VISITOR, { fetchImpl })).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    expect(settled).toBe(true);
    expect((await pending).reason).toBe("timeout");
  });

  it("makes exactly one send attempt (no retry that could duplicate the message)", async () => {
    const fetchImpl = routedFetch(() => reply(503, ""));
    await failure(sendContactMessage(VISITOR, { fetchImpl }));
    expect(sends(fetchImpl)).toHaveLength(1);
  });
});

describe("logFormError", () => {
  function captureConsole() {
    return {
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    };
  }
  function allOutput(spies: ReturnType<typeof captureConsole>) {
    return Object.values(spies)
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => (value instanceof Error ? `${value.stack} ${String(value.cause)}` : String(value)))
      .join("\n");
  }

  it("a Brevo rejection is one tagged error line with reason, status, code and request id — nothing personal", async () => {
    const error = await failure(sendContactMessage(VISITOR, { fetchImpl: mockFetch(async () => reply(401, ECHOING_BODY)) }));
    const spies = captureConsole();
    logFormError("contact", "req-1234abcd", error);

    expect(spies.error).toHaveBeenCalledOnce();
    expect(spies.error.mock.calls[0]).toEqual([
      `[marketing/contact] ${FORM_DELIVERY_FAILED_TAG} {"form":"contact","reason":"rejected","status":401,"code":"unauthorized","requestId":"req-1234abcd"}`,
    ]);
    const output = allOutput(spies);
    for (const secret of ["xkeysib-unit-test-secret", VISITOR.email, VISITOR.name, VISITOR.message, "Key not found"]) {
      expect(output).not.toContain(secret);
    }
  });

  it("a blocklisted inbox logs reason=recipient_blocked and nothing about the visitor", async () => {
    const fetchImpl = mockFetch(async () => reply(200, JSON.stringify({ contacts: [{ email: "support@vokr.shop" }], count: 1 })));
    const error = await failure(sendContactMessage(VISITOR, { fetchImpl }));
    const spies = captureConsole();
    logFormError("contact", "req-9999aaaa", error);
    expect(spies.error.mock.calls).toEqual([
      [`[marketing/contact] ${FORM_DELIVERY_FAILED_TAG} {"form":"contact","reason":"recipient_blocked","requestId":"req-9999aaaa"}`],
    ]);
    const output = allOutput(spies);
    for (const secret of ["xkeysib-unit-test-secret", VISITOR.email, VISITOR.name, VISITOR.message]) {
      expect(output).not.toContain(secret);
    }
  });

  it("a timeout logs reason=timeout under the tag", async () => {
    vi.useFakeTimers();
    const pending = failure(subscribeToNewsletter(VISITOR.email, { fetchImpl: hangingFetch() }));
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    const error = await pending;
    const spies = captureConsole();
    logFormError("newsletter", "req-5678efgh", error);
    expect(spies.error.mock.calls[0]?.[0]).toBe(
      `[marketing/newsletter] ${FORM_DELIVERY_FAILED_TAG} {"form":"newsletter","reason":"timeout","requestId":"req-5678efgh"}`,
    );
  });

  it("an unexpected error is tagged reason=unexpected and still logged with its cause for debugging", () => {
    const spies = captureConsole();
    logFormError("contact", "req-0000ffff", new Error("database exploded"));
    const lines = spies.error.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toBe(`[marketing/contact] ${FORM_DELIVERY_FAILED_TAG} {"form":"contact","reason":"unexpected","requestId":"req-0000ffff"}`);
    expect(lines.some((line) => line.includes("INTERNAL_ERROR"))).toBe(true);
  });

  it("validation and rate-limit refusals are not delivery failures: untagged warn only", () => {
    const spies = captureConsole();
    logFormError("contact", "req-1", new ValidationError("Enter a valid email address."));
    logFormError("newsletter", "req-2", new RateLimitError("Too many requests."));
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).toHaveBeenCalledTimes(2);
    expect(allOutput(spies)).not.toContain(FORM_DELIVERY_FAILED_TAG);
  });
});
