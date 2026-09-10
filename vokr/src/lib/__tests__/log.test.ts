import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import { logServerError } from "@/lib/log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logServerError", () => {
  it("logs an expected AppError as a compact warning carrying the requestId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError("auth/signup", "req-1", new ValidationError("bad email"));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("req-1");
    expect(warn.mock.calls[0]?.[0]).toContain("VALIDATION_ERROR");
    expect(error).not.toHaveBeenCalled();
  });

  it("logs an unexpected error at error level with the requestId that reaches the client", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError("auth/signup", "req-2", new Error("supabase key missing"));

    expect(error).toHaveBeenCalled();
    expect(error.mock.calls[0]?.[0]).toContain("req-2");
    expect(String(error.mock.calls[0]?.[1])).toContain("supabase key missing");
  });

  it("unwraps the cause chain so the real reason is visible", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logServerError(
      "auth/signup",
      "req-3",
      new Error("signUp() failed", { cause: new Error("root reason here") }),
    );

    const logged = error.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(logged).toContain("root reason here");
  });

  it("handles a thrown non-Error value without itself throwing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logServerError("x", "req-4", "a string")).not.toThrow();
  });
});
