import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isTransientTransactionError } from "../transient";

/**
 * Plan §5 Phase 8, task 5 and Testing Requirements: "the payments module
 * is unreachable from the inventory transaction". The Razorpay call must
 * never happen while an inventory row lock is held; the structural proof
 * is that nothing that runs inside the reservation transaction can import
 * the payments code at all.
 */

const SERVER = path.resolve(import.meta.dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // Tests drive payments end to end on purpose; only runtime code counts.
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map(
    (match) => match[1] as string,
  );
}

function reachesPayments(specifier: string, fromFile: string): boolean {
  if (specifier.startsWith("@/server/payments")) return true;
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), specifier).startsWith(path.join(SERVER, "payments"));
  }
  return /razorpay/i.test(specifier);
}

describe("architecture: Razorpay is never called inside the reservation transaction", () => {
  const files = [...sourceFiles(path.join(SERVER, "inventory")), path.join(SERVER, "checkout", "reserve.ts")];

  it("covers the inventory module and the reserve orchestration", () => {
    expect(files.some((file) => file.endsWith(path.join("inventory", "holds.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(path.join("checkout", "reserve.ts")))).toBe(true);
  });

  it.each(files.map((file) => [path.relative(SERVER, file), file]))("%s imports nothing from payments", (_name, file) => {
    const offending = importsOf(file).filter((specifier) => reachesPayments(specifier, file));
    expect(offending).toEqual([]);
  });
});

describe("isTransientTransactionError", () => {
  it.each([
    ["a Prisma interactive-transaction conflict", { code: "P2034" }],
    ["a raw-query deadlock", { code: "P2010", message: "Raw query failed. Code: `40P01`. Message: `deadlock detected`" }],
    ["a serialization failure in meta", { code: "P2010", meta: { code: "40001" } }],
    ["a lock_timeout in the cause chain", { message: "wrapped", cause: { code: "55P03" } }],
  ])("retries %s", (_label, error) => {
    expect(isTransientTransactionError(error)).toBe(true);
  });

  it.each([
    ["a CHECK violation", { code: "P2010", message: "Raw query failed. Code: `23514`" }],
    ["a unique violation", { code: "P2002" }],
    ["an application error", new Error("Some items in your bag are no longer available")],
    ["nothing", undefined],
  ])("does not retry %s", (_label, error) => {
    expect(isTransientTransactionError(error)).toBe(false);
  });
});
