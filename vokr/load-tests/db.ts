/**
 * Database side of the R10 HTTP load test (plan §5 Phase 21, task 4).
 *
 * k6 sees only HTTP status codes. Oversell, duplicate holds, deadlocks,
 * lock waits and reservation leaks are database facts, so every k6 run is
 * bracketed by this script against the same isolated database:
 *
 *   tsx load-tests/db.ts seed --stock 3            → one fresh variant, prints its id
 *   tsx load-tests/db.ts sample-locks --seconds 60 → lock-wait sampling while k6 runs
 *   tsx load-tests/db.ts verify --variant <id> --buyers 50 [--granted 3]
 *
 * `verify` checks the run, then backdates that variant's holds and runs
 * the real expiry job (`expireReservations`) to prove nothing leaks after
 * expiry. It writes rows, so it refuses to run against anything but a
 * local database whose name contains `load` — never staging or production.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ReservationState } from "@/generated/prisma/enums";
import { createActiveVariantFixture } from "@/server/cart/__tests__/fixtures";
import { prisma } from "@/server/db/client";
import { expireReservations } from "@/server/jobs/expire-reservations";

const RUNS_DIR = path.resolve(import.meta.dirname, ".runs");
const LOAD_PINCODE = "411001";

function assertIsolatedDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !database.includes("load")) {
    throw new Error(
      `Refusing to touch ${url.hostname}/${database}: the load-test database must be local and its name must contain "load".`,
    );
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function intArg(name: string, fallback?: number): number {
  const raw = arg(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return value;
}

async function deadlocks(): Promise<number> {
  const [row] = await prisma.$queryRaw<{ deadlocks: bigint }[]>`
    SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()
  `;
  return Number(row?.deadlocks ?? 0);
}

async function seed(): Promise<void> {
  const stock = intArg("stock", 3);
  await prisma.serviceablePincode.upsert({
    where: { pincode: LOAD_PINCODE },
    create: { pincode: LOAD_PINCODE, codEligible: false, estimatedDeliveryDays: 4 },
    update: {},
  });
  // Counters from an earlier run would turn this run's first requests into 429s.
  await prisma.rateLimitCounter.deleteMany({});
  const variant = await createActiveVariantFixture({
    name: "Load test fixture",
    category: "Test",
    gstRateBps: 1800,
    pricePaise: 999_500,
    quantityOnHand: stock,
  });
  const state = { variantId: variant.variantId, stock, deadlocksBefore: await deadlocks(), seededAt: new Date().toISOString() };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path.join(RUNS_DIR, `${variant.variantId}.json`), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
}

async function sampleLocks(): Promise<void> {
  const seconds = intArg("seconds", 60);
  const deadline = Date.now() + seconds * 1000;
  let samples = 0;
  let maxWaiting = 0;
  let waitingSamples = 0;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    const waiting = Number(row?.waiting ?? 0);
    samples += 1;
    if (waiting > 0) waitingSamples += 1;
    maxWaiting = Math.max(maxWaiting, waiting);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(JSON.stringify({ samples, intervalMs: 100, samplesWithLockWaiters: waitingSamples, maxConcurrentLockWaiters: maxWaiting }));
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function verify(): Promise<void> {
  const variantId = arg("variant");
  if (!variantId) throw new Error("--variant is required.");
  const buyers = intArg("buyers");
  const state = JSON.parse(readFileSync(path.join(RUNS_DIR, `${variantId}.json`), "utf8")) as {
    stock: number;
    deadlocksBefore: number;
  };
  const expectedHolds = Math.min(buyers, state.stock);
  const grantedByK6 = arg("granted") === undefined ? undefined : intArg("granted");
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  const inventory = await prisma.inventory.findUniqueOrThrow({
    where: { variantId },
    select: { quantityOnHand: true, quantityReserved: true },
  });
  check("on_hand unchanged and never negative", inventory.quantityOnHand === state.stock, `on_hand=${inventory.quantityOnHand} seeded=${state.stock}`);
  check(
    "no oversell (reserved <= on_hand)",
    inventory.quantityReserved <= inventory.quantityOnHand,
    `reserved=${inventory.quantityReserved} on_hand=${inventory.quantityOnHand}`,
  );

  const held = await prisma.inventoryReservation.findMany({
    where: { variantId, state: ReservationState.held },
    select: { checkoutSessionId: true, quantity: true },
  });
  const heldUnits = held.reduce((sum, row) => sum + row.quantity, 0);
  check("held units == min(buyers, stock)", heldUnits === expectedHolds, `held_units=${heldUnits} expected=${expectedHolds}`);
  check("reserved counter matches held rows", inventory.quantityReserved === heldUnits, `reserved=${inventory.quantityReserved} held_units=${heldUnits}`);
  const sessions = new Set(held.map((row) => row.checkoutSessionId));
  check("no duplicate holds (one row, one unit per session)", sessions.size === held.length && held.every((row) => row.quantity === 1), `rows=${held.length} sessions=${sessions.size}`);
  if (grantedByK6 !== undefined) {
    check("k6 200s == held sessions", grantedByK6 === sessions.size, `k6_granted=${grantedByK6} held_sessions=${sessions.size}`);
  }

  const orders = await prisma.orderItem.count({ where: { variantId } });
  check("no orders without payment", orders === 0, `order_items=${orders}`);

  const deadlocksAfter = await deadlocks();
  check("zero deadlocks", deadlocksAfter === state.deadlocksBefore, `pg_stat_database.deadlocks ${state.deadlocksBefore} -> ${deadlocksAfter}`);

  // Leak check: make this variant's holds lapse, then run the real expiry job.
  const sessionIds = [...sessions];
  if (sessionIds.length > 0) {
    await prisma.inventoryReservation.updateMany({
      where: { checkoutSessionId: { in: sessionIds } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.checkoutSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
  }
  const expiry = await expireReservations(null);
  const after = await prisma.inventory.findUniqueOrThrow({ where: { variantId }, select: { quantityReserved: true } });
  const stillHeld = await prisma.inventoryReservation.count({ where: { variantId, state: ReservationState.held } });
  check(
    "zero reservation leaks after expiry",
    stillHeld === 0 && after.quantityReserved === 0 && expiry.errors === 0,
    `held_after=${stillHeld} reserved_after=${after.quantityReserved} expiry=${JSON.stringify(expiry.outcomes)} errors=${expiry.errors}`,
  );

  const failed = checks.filter((entry) => !entry.pass);
  for (const entry of checks) console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.name}  (${entry.detail})`);
  console.log(JSON.stringify({ variantId, buyers, stock: state.stock, pass: failed.length === 0 }));
  if (failed.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  assertIsolatedDatabase();
  const command = process.argv[2];
  if (command === "seed") await seed();
  else if (command === "sample-locks") await sampleLocks();
  else if (command === "verify") await verify();
  else throw new Error(`Unknown command "${command}". Use seed | sample-locks | verify.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
