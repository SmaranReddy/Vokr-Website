import { describe, expect, it } from "vitest";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  toErrorResponse,
} from "@/lib/errors";

describe("toErrorResponse", () => {
  it.each([
    [ValidationError, 400, "VALIDATION_ERROR"],
    [NotFoundError, 404, "NOT_FOUND"],
    [ConflictError, 409, "CONFLICT"],
    [RateLimitError, 429, "RATE_LIMITED"],
    [InternalError, 500, "INTERNAL_ERROR"],
  ] as const)(
    "maps %s to status %d and code %s",
    (ErrorClass, status, code) => {
      const { status: actualStatus, body } = toErrorResponse(
        new ErrorClass("boom"),
      );
      expect(actualStatus).toBe(status);
      expect(body.error.code).toBe(code);
      expect(body.error.message).toBe("boom");
      expect(body.error.requestId).toEqual(expect.any(String));
    },
  );

  it("maps an unrecognised thrown value to a generic 500 with no internal detail leaked", () => {
    const internalOnly = new Error("db connection string leaked here");
    const { status, body } = toErrorResponse(internalOnly);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("db connection string");
  });

  it("assigns a distinct requestId to every response", () => {
    const a = toErrorResponse(new ValidationError("x"));
    const b = toErrorResponse(new ValidationError("x"));
    expect(a.requestId).not.toBe(b.requestId);
  });
});
