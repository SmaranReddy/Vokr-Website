import { AppError } from "./errors";

/**
 * Server-side error logging for API routes.
 *
 * `toErrorResponse()` deliberately strips every internal detail from the
 * response body and replaces it with a `requestId` — which is only useful
 * if something actually writes that id, and the real error, somewhere a
 * developer can read. Nothing did: every route caught its errors, returned
 * a generic 500 and discarded the cause, so a failing request left *no*
 * trace in the server log at all. (This is exactly how the Phase 3 signup
 * bug presented: an empty `NEXT_PUBLIC_SUPABASE_ANON_KEY` made
 * `createRouteSupabaseClient()` throw before any Supabase call was made,
 * and the terminal stayed silent.) Call this at every `toErrorResponse()`
 * site, passing the same `requestId` that goes into the body, so a report
 * of "request 93c67803… failed" is traceable to a cause.
 *
 * Logs to stderr/stdout only — never to the response. Expected errors
 * (`AppError`: validation, auth, rate limit) log one compact `warn` line
 * with no stack; anything unexpected logs at `error` with the full cause
 * chain, because that is a bug or a misconfiguration someone must see.
 */
export function logServerError(
  scope: string,
  requestId: string,
  error: unknown,
): void {
  if (error instanceof AppError) {
    console.warn(
      `[${scope}] ${error.code} requestId=${requestId}: ${error.message}`,
    );
    return;
  }

  console.error(
    `[${scope}] INTERNAL_ERROR requestId=${requestId}:`,
    error instanceof Error ? (error.stack ?? error.message) : error,
  );

  // `cause` is where the real reason usually lives once an error has been
  // wrapped (e.g. a fetch failure under a Supabase client error).
  let cause = error instanceof Error ? error.cause : undefined;
  let depth = 0;
  while (cause !== undefined && depth < 3) {
    console.error(
      `[${scope}]   caused by:`,
      cause instanceof Error ? (cause.stack ?? cause.message) : cause,
    );
    cause = cause instanceof Error ? cause.cause : undefined;
    depth += 1;
  }
}
