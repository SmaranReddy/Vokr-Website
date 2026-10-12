import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reset form must never redeem the link itself. It used to call
 * `exchangeCodeForSession(code)` in the browser, which only worked in the
 * browser that requested the reset (Vokr-Implementation-Plan.md, Phase 3
 * defect log round 3). `/api/auth/reset/confirm` now redeems the link on
 * the server; this component only checks that a session exists.
 */

let searchParams = new URLSearchParams();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

const getUser = vi.fn();
const updateUser = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser, updateUser, exchangeCodeForSession },
  }),
}));

const { ResetPasswordForm } = await import(
  "@/components/auth/reset-password-form"
);

const LINK_ERROR = /This reset link is invalid or has expired/;

beforeEach(() => {
  searchParams = new URLSearchParams();
  getUser.mockReset();
  updateUser.mockReset();
  exchangeCodeForSession.mockReset();
  push.mockReset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ResetPasswordForm", () => {
  it("shows the password form when the server already established a recovery session", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    render(<ResetPasswordForm />);

    expect(await screen.findByLabelText("New password")).toBeTruthy();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
  });

  it("never calls exchangeCodeForSession, even when the URL carries a ?code=", async () => {
    window.history.replaceState(null, "", "/reset-password?code=legacy-pkce-code");
    searchParams = new URLSearchParams("code=legacy-pkce-code");
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    render(<ResetPasswordForm />);

    await screen.findByLabelText("New password");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("shows the link error and no form when there is no session", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
    });

    render(<ResetPasswordForm />);

    expect(await screen.findByText(LINK_ERROR)).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("trusts ?error=link over any existing session and never shows the form", async () => {
    searchParams = new URLSearchParams("error=link");
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    render(<ResetPasswordForm />);

    expect(screen.getByText(LINK_ERROR)).toBeTruthy();
    await waitFor(() => expect(getUser).not.toHaveBeenCalled());
    expect(screen.queryByLabelText("New password")).toBeNull();
  });
});
