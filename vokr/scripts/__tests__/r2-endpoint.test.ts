import { describe, expect, it } from "vitest";

import { endpointOverride, readR2Config } from "../lib/r2";

describe("R2 endpoint override (rehearsals only)", () => {
  it("is off unless set", () => {
    expect(endpointOverride(undefined)).toBeUndefined();
    expect(endpointOverride("")).toBeUndefined();
  });

  it("accepts only plain-HTTP local hosts", () => {
    for (const ok of ["http://127.0.0.1:59000", "http://localhost:9000", "http://host.docker.internal:59000", "http://minio:9000"]) {
      expect(endpointOverride(ok)).toBe(ok);
    }
    for (const bad of ["https://evil.example.com", "http://evil.example.com", "http://127.0.0.1.evil.com", "http://localhost@evil.com", "https://abc.r2.cloudflarestorage.com"]) {
      expect(() => endpointOverride(bad), bad).toThrow(/local test endpoint/);
    }
  });

  it("readR2Config names missing variables, never values", () => {
    const env = { R2_ACCOUNT_ID: "acct", R2_SECRET_ACCESS_KEY: "super-secret" } as unknown as NodeJS.ProcessEnv;
    expect(() => readR2Config(env, "R2_BACKUP_BUCKET")).toThrow(
      "R2 is not configured: R2_ACCESS_KEY_ID, R2_BACKUP_BUCKET must be set.",
    );
  });
});
