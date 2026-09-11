/**
 * Shared reading of the error object Supabase Auth returns.
 *
 * Extracted from `signup-error.ts` when the password-reset route needed
 * the same treatment (see `reset-error.ts`). The per-route *policy* —
 * which codes are safe to state plainly and which must stay behind a
 * generic message — deliberately does **not** live here: it differs by
 * route, and folding it into one shared classifier is how a rule that is
 * correct for signup gets applied to recovery, where it leaks.
 */

export interface SupabaseErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/**
 * Narrows an unknown thrown/returned value to the three fields worth
 * branching on, discarding anything of the wrong type. Supabase's error
 * shape is not guaranteed by our types at runtime — it arrives over the
 * wire — so every field is treated as untrusted.
 */
export function readSupabaseError(error: unknown): SupabaseErrorLike {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const { code, status, message } = error as SupabaseErrorLike;
  return {
    code: typeof code === "string" ? code : undefined,
    status: typeof status === "number" ? status : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

/** Codes GoTrue uses when its own send/request limiter trips. */
export const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

export function isRateLimit({ code, status }: SupabaseErrorLike): boolean {
  return (code !== undefined && RATE_LIMIT_CODES.has(code)) || status === 429;
}

/** One-line, log-only rendering of a Supabase failure. Never sent to a client. */
export function describeSupabaseError(
  call: string,
  { code, status, message }: SupabaseErrorLike,
): string {
  return (
    `${call} failed: code=${code ?? "unknown"} ` +
    `status=${status ?? "unknown"} message=${message ?? "(none)"}`
  );
}
