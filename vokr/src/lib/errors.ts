/**
 * Typed error hierarchy for API routes. Every route from Phase 2 onward
 * throws one of these (or lets an unexpected error propagate) and returns
 * the result of `toErrorResponse()` — never a hand-rolled error shape,
 * and never an internal message or stack trace across the API boundary.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "ORDERING_UNAVAILABLE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OUT_OF_STOCK"
  | "RESERVATION_EXPIRED"
  | "CHECKOUT_STALE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    /** Machine-readable specifics a client can act on, e.g. which lines are short. Never internal state. */
    details?: Record<string, unknown>;
  };
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  /** Sent to the client as `error.details`; must hold nothing internal. */
  readonly details?: Record<string, unknown>;

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

/**
 * 403 — a purchase action was attempted while ordering is disabled
 * (`ORDERING_ENABLED`, Vokr-Implementation-Plan.md §2A.6 row L1). Its
 * message is the same customer-facing text the UI shows.
 */
export class OrderingUnavailableError extends AppError {
  readonly code = "ORDERING_UNAVAILABLE" as const;
  readonly status = 403;
}

/** 404 — the requested resource does not exist (or is not visible). */
export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
}

/** 409 — the request conflicts with current state (e.g. stock, idempotency). */
export class ConflictError extends AppError {
  readonly code: "CONFLICT" | "OUT_OF_STOCK" | "RESERVATION_EXPIRED" | "CHECKOUT_STALE" = "CONFLICT";
  readonly status = 409;
}

/** One cart line that cannot be had in the quantity asked for. */
export interface UnavailableLine {
  variantId: string;
  requested: number;
  available: number;
}

/**
 * 409 `OUT_OF_STOCK` — not enough stock for what was asked. When the lines
 * are known they travel as `details.unavailable`, so the client can mark
 * exactly those lines rather than guess from the message.
 */
export class OutOfStockError extends ConflictError {
  override readonly code = "OUT_OF_STOCK" as const;
  declare readonly details?: { unavailable: UnavailableLine[] };

  constructor(message: string, unavailable?: readonly UnavailableLine[]) {
    super(message);
    if (unavailable) this.details = { unavailable: [...unavailable] };
  }
}

/** 409 `RESERVATION_EXPIRED` — the stock hold lapsed; checkout has to start again. */
export class ReservationExpiredError extends ConflictError {
  override readonly code = "RESERVATION_EXPIRED" as const;
}

/** 409 `CHECKOUT_STALE` — the bag or its price changed since it was priced; review it again. */
export class CheckoutStaleError extends ConflictError {
  override readonly code = "CHECKOUT_STALE" as const;
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
export function toErrorResponse(error: unknown, assignedRequestId?: string): {
  status: number;
  body: ErrorResponseBody;
  requestId: string;
} {
  // The proxy-assigned id when the route passes one (`requestIdOf`), so the
  // body, the `x-request-id` header and the log line all agree.
  const requestId = assignedRequestId ?? generateRequestId();

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
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
