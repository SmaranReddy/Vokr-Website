import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/marketing/contact` and `POST /api/marketing/newsletter`, the
 * real route handlers, with Brevo replaced by a mocked global `fetch` (any
 * unexpected call fails the test — nothing can reach the real API) and the
 * Postgres-backed rate limiter mocked. A form only says it succeeded when
 * Brevo accepted it; every Brevo failure is a 500 with the visitor-facing
 * message, a request id, and one sanitized `FORM_DELIVERY_FAILED` log line.
 */

const env = { BREVO_API_KEY: "xkeysib-route-test-secret" as string | undefined };
vi.mock("@/lib/env", () => ({ requireServerEnv: () => env }));

const assertWithinRateLimit = vi.fn(async () => undefined);
vi.mock("@/server/rate-limit", () => ({
  assertWithinRateLimit: (...args: unknown[]) => assertWithinRateLimit(...(args as [])),
}));

const contact = await import("@/app/api/marketing/contact/route");
const newsletter = await import("@/app/api/marketing/newsletter/route");
const { FORM_DELIVERY_FAILED_TAG, FORM_TIMEOUT_MS } = await import("../brevo");
const { RateLimitError } = await import("@/lib/errors");

const VISITOR = {
  name: "Asha Visitor",
  email: "asha.visitor@example.com",
  orderNumber: "VK-10001",
  message: "The left insole tore after a week.",
};
const SECRETS = ["xkeysib-route-test-secret", VISITOR.email, VISITOR.name, VISITOR.message, VISITOR.orderNumber];

let fetchMock: ReturnType<typeof vi.fn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  env.BREVO_API_KEY = "xkeysib-route-test-secret";
  assertWithinRateLimit.mockClear();
  assertWithinRateLimit.mockImplementation(async () => undefined);
  fetchMock = vi.fn(async () => {
    throw new Error("unexpected fetch — the test did not set a Brevo reply");
  });
  vi.stubGlobal("fetch", fetchMock);
  consoleSpies = (["error", "warn", "info", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function post(route: { POST: (request: NextRequest) => Promise<Response> }, path: string, body: string) {
  return route.POST(
    new NextRequest(`https://vokr.shop/api/marketing/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}
const postContact = (body: unknown = VISITOR) => post(contact, "contact", typeof body === "string" ? body : JSON.stringify(body));
const postNewsletter = (body: unknown = { email: VISITOR.email }) =>
  post(newsletter, "newsletter", typeof body === "string" ? body : JSON.stringify(body));

function brevoReplies(status: number, body: unknown = {}) {
  fetchMock.mockImplementation(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }));
}
/** The contact route reads the blocklist first; it answers with `blocklist`, the send with `status`/`body`. */
function brevoSend(status: number, body: unknown = {}, blocklist: unknown = { contacts: [], count: 0 }) {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes("/smtp/blockedContacts")
      ? new Response(JSON.stringify(blocklist), { status: 200 })
      : new Response(JSON.stringify(body), { status }),
  );
}
function sendCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/smtp/email")) as [string, RequestInit][];
}
function brevoHangs() {
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

function logOutput(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((value) => (value instanceof Error ? `${value.stack}` : String(value)))
    .join("\n");
}
function taggedLines(): string[] {
  return logOutput()
    .split("\n")
    .filter((line) => line.includes(FORM_DELIVERY_FAILED_TAG));
}

async function expectFailure(response: Response, message: string) {
  expect(response.status).toBe(500);
  const body = (await response.json()) as { message?: string; error?: { code: string; message: string; requestId: string } };
  expect(body.message).toBeUndefined();
  expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", message });
  expect(body.error?.requestId).toEqual(expect.any(String));
  expect(JSON.stringify(body)).not.toMatch(/brevo|xkeysib|unauthorized/i);
  return body.error!.requestId;
}

describe("POST /api/marketing/contact", () => {
  const FAILED = "Could not send your message. Please try again.";

  it("200 only after Brevo accepts the email; nothing logged as a failure", async () => {
    brevoSend(201, { messageId: "<m@smtp-relay.brevo.com>" });
    const response = await postContact();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Thanks — we'll get back to you soon." });
    expect(sendCalls()).toHaveLength(1);
    const sent = JSON.parse(String(sendCalls()[0]![1].body)) as { textContent: string };
    expect(sent.textContent).toBe(`Order number: ${VISITOR.orderNumber}\n\n${VISITOR.message}`);
    expect(taggedLines()).toEqual([]);
  });

  it.each([
    [401, { code: "unauthorized", message: `Key not found ${VISITOR.email}` }, "unauthorized"],
    [403, { code: "permission_denied", message: "unrecognised IP address" }, "permission_denied"],
    [400, { code: "invalid_parameter", message: `sender invalid for ${VISITOR.email}` }, "invalid_parameter"],
    [500, { message: "internal" }, undefined],
  ])("Brevo %i → 500, one sanitized tagged log line", async (status, body, code) => {
    brevoSend(status, body);
    const requestId = await expectFailure(await postContact(), FAILED);

    const lines = taggedLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.slice(lines[0]!.indexOf("{")))).toEqual({
      form: "contact",
      reason: "rejected",
      status,
      ...(code ? { code } : {}),
      requestId,
    });
    const output = logOutput();
    for (const secret of SECRETS) expect(output).not.toContain(secret);
    expect(output).not.toContain("Key not found");
  });

  it("support@ on Brevo's blocklist → 500 with reason=recipient_blocked, and no email is sent", async () => {
    brevoSend(201, { messageId: "<m@smtp-relay.brevo.com>" }, {
      contacts: [{ email: "support@vokr.shop", reason: { code: "hardBounce", message: "hard bounce" } }],
      count: 1,
    });
    const requestId = await expectFailure(await postContact(), FAILED);

    expect(sendCalls()).toHaveLength(0);
    expect(taggedLines()).toEqual([
      `[marketing/contact] ${FORM_DELIVERY_FAILED_TAG} {"form":"contact","reason":"recipient_blocked","requestId":"${requestId}"}`,
    ]);
    const output = logOutput();
    for (const secret of SECRETS) expect(output).not.toContain(secret);
  });

  it("a 2xx without a messageId → 500 with reason=unconfirmed", async () => {
    brevoSend(201, {});
    await expectFailure(await postContact(), FAILED);
    expect(taggedLines()[0]).toContain('"reason":"unconfirmed"');
  });

  it("an unreadable blocklist → 500, and no email is sent", async () => {
    brevoReplies(503, { message: "unavailable" });
    await expectFailure(await postContact(), FAILED);
    expect(sendCalls()).toHaveLength(0);
    expect(taggedLines()[0]).toContain('"status":503');
  });

  it("a Brevo stall times out → 500 with reason=timeout, not a hung request", async () => {
    vi.useFakeTimers();
    brevoHangs();
    const pending = postContact();
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    await expectFailure(await pending, FAILED);
    expect(taggedLines()).toHaveLength(1);
    expect(taggedLines()[0]).toContain('"reason":"timeout"');
  });

  it("a network failure → 500 with reason=network", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expectFailure(await postContact(), FAILED);
    expect(taggedLines()[0]).toContain('"reason":"network"');
  });

  it("no key → 500 with reason=not_configured and no request", async () => {
    env.BREVO_API_KEY = undefined;
    await expectFailure(await postContact(), FAILED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taggedLines()[0]).toContain('"reason":"not_configured"');
  });

  it("malformed JSON is a 400, and the body is not logged", async () => {
    const response = await postContact(`{"message":"${VISITOR.message}"`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taggedLines()).toEqual([]);
    expect(logOutput()).not.toContain(VISITOR.message);
  });

  it("an invalid body is a 400 with no Brevo call and no failure tag", async () => {
    const response = await postContact({ ...VISITOR, email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taggedLines()).toEqual([]);
  });

  it("a rate-limited caller gets 429 with no Brevo call and no failure tag", async () => {
    assertWithinRateLimit.mockImplementation(async () => {
      throw new RateLimitError("Too many requests. Please try again later.");
    });
    const response = await postContact();
    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taggedLines()).toEqual([]);
  });
});

describe("POST /api/marketing/newsletter", () => {
  const FAILED = "Could not complete the newsletter signup.";

  it("200 when Brevo creates the contact", async () => {
    brevoReplies(201, { id: 7 });
    const response = await postNewsletter();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "You're on the list." });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("200 when the visitor is already subscribed (400 duplicate_parameter)", async () => {
    brevoReplies(400, { code: "duplicate_parameter", message: "Contact already exist" });
    const response = await postNewsletter();
    expect(response.status).toBe(200);
    expect(taggedLines()).toEqual([]);
  });

  it("Brevo 401 → 500 with one sanitized tagged log line", async () => {
    brevoReplies(401, { code: "unauthorized", message: `Key not found ${VISITOR.email}` });
    const requestId = await expectFailure(await postNewsletter(), FAILED);
    expect(taggedLines()).toEqual([
      `[marketing/newsletter] ${FORM_DELIVERY_FAILED_TAG} {"form":"newsletter","reason":"rejected","status":401,"code":"unauthorized","requestId":"${requestId}"}`,
    ]);
    const output = logOutput();
    for (const secret of SECRETS) expect(output).not.toContain(secret);
  });

  it("a Brevo stall times out → 500 with reason=timeout", async () => {
    vi.useFakeTimers();
    brevoHangs();
    const pending = postNewsletter();
    await vi.advanceTimersByTimeAsync(FORM_TIMEOUT_MS);
    await expectFailure(await pending, FAILED);
    expect(taggedLines()[0]).toContain('"reason":"timeout"');
  });

  it("malformed JSON is a 400 with no Brevo call", async () => {
    const response = await postNewsletter("email=asha");
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(taggedLines()).toEqual([]);
  });

  it("an invalid email keeps its customer copy", async () => {
    const response = await postNewsletter({ email: "nope" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("Enter a valid email address.");
  });
});
