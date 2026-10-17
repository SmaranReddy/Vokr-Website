import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The contact and newsletter forms show success only on a 2xx from their
 * route. A 500 with the API's error body shows that message; a non-JSON
 * failure (a Cloud Run/Cloudflare HTML 502/504 page) or a network failure
 * shows the generic error. A failed submission never clears what the
 * visitor typed.
 */

const { ContactForm } = await import("../contact-form");
const { NewsletterForm } = await import("../newsletter-form");

let reply: () => Promise<Response>;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply()),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const apiError = (message: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message, requestId: "req-1" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  );
const htmlGatewayTimeout = () => Promise.resolve(new Response("<html><body>504 Gateway Timeout</body></html>", { status: 504 }));
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function fillContact() {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Asha" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "asha@example.com" } });
  fireEvent.change(screen.getByLabelText("How can we help?"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send Message" }));
}

describe("ContactForm", () => {
  it("shows success and clears the form only on a 200", async () => {
    reply = () => Promise.resolve(Response.json({ message: "Thanks — we'll get back to you soon." }));
    render(<ContactForm />);
    fillContact();
    expect(await screen.findByText("Thanks — we'll get back to you soon.")).toBeTruthy();
    expect((screen.getByLabelText("How can we help?") as HTMLTextAreaElement).value).toBe("");
  });

  it.each([
    ["a 500 with the API error", () => apiError("Could not send your message. Please try again."), "Could not send your message. Please try again."],
    ["a non-JSON 504 page", htmlGatewayTimeout, "Something went wrong. Please try again."],
    ["a network failure", offline, "Something went wrong. Please try again."],
  ])("%s shows an error, never success, and keeps the message", async (_label, failure, shown) => {
    reply = failure;
    render(<ContactForm />);
    fillContact();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(shown));
    expect(screen.queryByText(/get back to you soon/)).toBeNull();
    expect((screen.getByLabelText("How can we help?") as HTMLTextAreaElement).value).toBe("Hello");
    expect((screen.getByRole("button", { name: "Send Message" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("NewsletterForm", () => {
  function submit() {
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "asha@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
  }

  it("shows success only on a 200", async () => {
    reply = () => Promise.resolve(Response.json({ message: "You're on the list." }));
    render(<NewsletterForm />);
    submit();
    expect(await screen.findByText("You're on the list.")).toBeTruthy();
  });

  it.each([
    ["a 500 with the API error", () => apiError("Could not complete the newsletter signup."), "Could not complete the newsletter signup."],
    ["a non-JSON 504 page", htmlGatewayTimeout, "Something went wrong. Please try again."],
    ["a network failure", offline, "Something went wrong. Please try again."],
  ])("%s shows an error, never success, and keeps the email", async (_label, failure, shown) => {
    reply = failure;
    render(<NewsletterForm />);
    submit();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toBe(shown));
    expect(screen.queryByText("You're on the list.")).toBeNull();
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("asha@example.com");
  });
});
