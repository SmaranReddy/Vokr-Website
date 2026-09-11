/**
 * Typed error hierarchy for API routes. Every route from Phase 2 onward
 * throws one of these (or lets an unexpected error propagate) and returns
 * the result of `toErrorResponse()` — never a hand-rolled error shape,
 * and never an internal message or stack trace across the API boundary.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** 400 — the request itself is malformed or fails validation. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR" as const;
  readonly status = 400;
}

/** 401 — no identity, or the identity presented is not valid. */
export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED" as const;
  readonly status = 401;
}

/** 404 — the requested resource does not exist (or is not visible). */
export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
}

/** 409 — the request conflicts with current state (e.g. stock, idempotency). */
export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
}

/** 429 — the caller has exceeded a rate limit. */
export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
}

/** 500 — anything unexpected. The only case that must never leak `message`. */
export class InternalError extends AppError {
  readonly code = "INTERNAL_ERROR" as const;
  readonly status = 500;
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Maps any thrown value to a `{ status, body }` pair safe to send across
 * the API boundary. A recognised `AppError` keeps its own status, code and
 * message. Anything else — a thrown string, a library error, a bug — is
 * treated as an unhandled failure: logged with its request ID (the caller
 * is responsible for the actual logging call; this function only assigns
 * the ID) and reduced to a generic 500 with **no internal detail**, in
 * every environment. There is no "helpful in dev" leak, because dev and
 * prod must exercise the same contract.
 */
export function toErrorResponse(error: unknown): {
  status: number;
  body: ErrorResponseBody;
  requestId: string;
} {
  const requestId = generateRequestId();

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      requestId,
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
        requestId,
      },
    },
    requestId,
  };
}
