import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { NotFoundError, RateLimitError, ValidationError } from "@/lib/errors";
import { decryptField, encryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";
import { consumeRateLimit } from "@/server/rate-limit";

import { ORDER_VIEW_SELECT, toOrderView, type OrderView } from "./view";

/**
 * Guest order lookup (plan §5 Phase 9, task 6) — order number + email, no
 * login, because the returns page promises "no login required". It is the
 * most exposed endpoint in the application, so every way of failing looks
 * the same from outside:
 *
 * - one 404 body for an unknown number, a wrong email or a malformed
 *   number, and one 429 body for every limit;
 * - the email is the second factor: compared as SHA-256 digests with
 *   `timingSafeEqual`, and a miss decrypts a dummy ciphertext so the work
 *   done is the same;
 * - every response — success included — is held to at least
 *   {@link LOOKUP_MIN_DURATION_MS}, so the database's found/not-found
 *   timing never reaches the caller;
 * - limits per IP and per order number are taken before the lookup, and
 *   the per-number one counts every attempt on that number whether or not
 *   it exists, so a lockout reveals nothing either.
 *
 * The view carries no name, phone or email — only what the order tracker
 * shows.
 */

export const LOOKUP_MIN_DURATION_MS = 800;
export const LOOKUP_NOT_FOUND_MESSAGE = "We couldn't find an order matching those details.";
export const LOOKUP_RATE_LIMITED_MESSAGE = "Too many attempts. Please try again later.";

export const LOOKUP_LIMITS = {
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  perOrderNumber: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const;

export const lookupBodySchema = z
  .object({
    orderNumber: z.string().max(40),
    email: z.string().max(254),
  })
  .strict();

export type GuestOrderView = OrderView;

/** `VK-10234`, `vk10234`, ` VK-10234 ` → `VK-10234`; anything else → `null`. */
export function normalizeOrderNumber(input: string): string | null {
  const match = /^VK-?(\d{5,12})$/i.exec(input.trim());
  return match ? `VK-${match[1]}` : null;
}

function emailDigest(email: string): Buffer {
  return createHash("sha256").update(email.trim().toLowerCase()).digest();
}

let dummyCiphertext: string | null = null;
/** Decrypted on a miss so a wrong number costs the same as a wrong email. */
function dummyEmailCiphertext(): string {
  dummyCiphertext ??= encryptField("no-such-order@invalid.example");
  return dummyCiphertext;
}

/** The lookup itself: the order when number and email both match, otherwise `null`. Never throws for a mismatch. */
export async function findGuestOrder(orderNumberInput: string, emailInput: string): Promise<GuestOrderView | null> {
  const orderNumber = normalizeOrderNumber(orderNumberInput);
  const order = orderNumber
    ? await prisma.order.findUnique({
        where: { orderNumber },
        select: { ...ORDER_VIEW_SELECT, contactEmailEnc: true },
      })
    : null;

  const stored = decryptField(order?.contactEmailEnc ?? dummyEmailCiphertext());
  const matches = timingSafeEqual(emailDigest(stored), emailDigest(emailInput));
  if (!order || !matches) return null;

  return toOrderView(order);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The whole request: limits, lookup, uniform errors, uniform timing.
 * Returns the order or throws {@link NotFoundError} / {@link RateLimitError}
 * / {@link ValidationError} with fixed messages — after the time floor.
 */
export async function lookupGuestOrder(
  input: { ip: string; body: unknown },
  options: { minDurationMs?: number } = {},
): Promise<GuestOrderView> {
  const startedAt = Date.now();
  const floor = options.minDurationMs ?? LOOKUP_MIN_DURATION_MS;
  let outcome: { order: GuestOrderView } | { error: Error };
  try {
    outcome = { order: await lookupOnce(input) };
  } catch (error) {
    outcome = { error: error instanceof Error ? error : new Error(String(error)) };
  }
  const remaining = floor - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
  if ("error" in outcome) throw outcome.error;
  return outcome.order;
}

async function lookupOnce({ ip, body }: { ip: string; body: unknown }): Promise<GuestOrderView> {
  const parsed = lookupBodySchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Enter your order number and email.");

  const ipLimit = await consumeRateLimit({ key: `orders:lookup:ip:${ip}`, ...LOOKUP_LIMITS.perIp });
  if (!ipLimit.allowed) throw new RateLimitError(LOOKUP_RATE_LIMITED_MESSAGE);
  // Keyed on the normalised number when there is one, the raw input
  // otherwise — every number is limited the same way, real or not.
  const numberKey = normalizeOrderNumber(parsed.data.orderNumber) ?? parsed.data.orderNumber.trim().toUpperCase();
  const numberLimit = await consumeRateLimit({
    key: `orders:lookup:number:${numberKey}`,
    ...LOOKUP_LIMITS.perOrderNumber,
  });
  if (!numberLimit.allowed) throw new RateLimitError(LOOKUP_RATE_LIMITED_MESSAGE);

  const order = await findGuestOrder(parsed.data.orderNumber, parsed.data.email);
  if (!order) throw new NotFoundError(LOOKUP_NOT_FOUND_MESSAGE);
  return order;
}
