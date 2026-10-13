import type { EmailOtpType } from "@supabase/supabase-js";

import { isValidTokenHash } from "./otp-link";

/**
 * Validation for the email-confirmation endpoint (`/api/auth/confirm`).
 *
 * Supabase's documented server-side confirmation flow sends the customer a
 * link carrying `token_hash` + `type`, which the server exchanges via
 * `verifyOtp()`. Unlike `exchangeCodeForSession()` — which the OAuth
 * callback uses, and which needs the PKCE code verifier cookie written by
 * the browser that *started* the flow — `verifyOtp()` needs nothing from
 * the browser. That is the whole point: confirmation links are opened on a
 * different device, in webmail, or by a mail-provider link scanner far
 * more often than not, and the PKCE route fails in every one of those
 * cases (see Vokr-Implementation-Plan.md, Phase 3 verification round 2).
 *
 * Kept out of the route file so it is unit-testable: the Vitest `node`
 * project covers `src/server/**` and `src/lib/**`, not `src/app/**`.
 */

/**
 * The only OTP types this endpoint will exchange for a session.
 *
 * Deliberately just `signup`. Every other `EmailOtpType` is excluded on
 * purpose, and widening this set is a security decision, not a formality:
 *
 * - `recovery` must never be accepted here. A recovery token legitimately
 *   mints a session — that is how `/reset-password` lets someone set a new
 *   password — but it does so on a page that immediately requires the new
 *   password. Accepting it at this endpoint would instead drop the visitor
 *   at `next` holding a full session having never set one, so anything
 *   that reaches a reset email (a stale inbox, a link scanner) becomes a
 *   sign-in. The password-reset flow keeps its own route.
 * - `email_change` / `email` belong to the email-change flow, which Phase 3
 *   explicitly defers (plan §5 Phase 3, task 9 — no UI entry point exists).
 * - `magiclink` / `invite` are flows this application does not offer.
 *
 * Add a type here only alongside the flow that issues it.
 */
export const CONFIRMABLE_OTP_TYPES = ["signup"] as const;

export type ConfirmableOtpType = Extract<
  EmailOtpType,
  (typeof CONFIRMABLE_OTP_TYPES)[number]
>;

/** Where a confirmed customer lands when the link carries no `next`. */
export const DEFAULT_NEXT_PATH = "/";

export type ConfirmParams =
  | {
      ok: true;
      tokenHash: string;
      type: ConfirmableOtpType;
      /** Always a same-origin absolute path beginning with a single "/". */
      next: string;
    }
  | { ok: false; reason: string };

function isConfirmableType(value: string): value is ConfirmableOtpType {
  return (CONFIRMABLE_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Reduces an untrusted `next` to a same-origin path, falling back to
 * {@link DEFAULT_NEXT_PATH} rather than rejecting the request — a
 * confirmation that succeeded should not be thrown away over a bad
 * redirect hint.
 *
 * Rejects anything that is not a single-slash-prefixed path, which is what
 * stops an open redirect: `//evil.example` and `/\evil.example` are both
 * read as protocol-relative URLs by browsers, and an absolute
 * `https://evil.example` is not a path at all. Percent-encoded slashes are
 * safe to keep, because resolving a single-slash path against our own
 * origin can never change host.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) {
    return DEFAULT_NEXT_PATH;
  }
  if (raw.startsWith("//") || raw.startsWith("/\\")) {
    return DEFAULT_NEXT_PATH;
  }
  // Control characters (CR/LF especially) must never reach a Location
  // header or a log line.
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    return DEFAULT_NEXT_PATH;
  }
  return raw;
}

/**
 * Validates the query string of an incoming confirmation link.
 *
 * `reason` is for the server log only — every failure returns the same
 * generic redirect to the caller, so nothing here tells an attacker which
 * part of a forged link was wrong.
 */
export function parseConfirmParams(params: URLSearchParams): ConfirmParams {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (!tokenHash) {
    return { ok: false, reason: "missing token_hash" };
  }
  if (!isValidTokenHash(tokenHash)) {
    return { ok: false, reason: "malformed token_hash" };
  }
  if (!type) {
    return { ok: false, reason: "missing type" };
  }
  if (!isConfirmableType(type)) {
    return {
      ok: false,
      reason:
        `type "${type}" is not confirmable here ` +
        `(allowed: ${CONFIRMABLE_OTP_TYPES.join(", ")})`,
    };
  }

  return {
    ok: true,
    tokenHash,
    type,
    next: safeNextPath(params.get("next")),
  };
}
