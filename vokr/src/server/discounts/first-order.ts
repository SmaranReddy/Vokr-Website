import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus } from "@/generated/prisma/enums";
import { decryptField, keyedLookupHash } from "@/server/checkout/crypto";

/**
 * 10% off the products of a customer's first order (owner decisions,
 * 21 Oct 2026). A customer is "new" only if none of their phone, email,
 * or name + delivery address has a claim in `first_order_discount_claims`
 * — no OTP, so the name + address key catches a repeat customer who
 * brings a new number or email.
 *
 * An order claims its keys when it is paid. "First order" means one that
 * is fulfilled with no return or refund, so an order that ends cancelled,
 * refunded, returned or RTO releases its claims (`transitionOrder`) and the
 * customer qualifies again. Deleting an account never releases them.
 *
 * Not applied to shipping. The amount is 10% per line rounded DOWN to
 * whole rupees (₹6,999 → ₹699 off): the store shows and charges whole
 * rupees, and the owner asked for ₹699, not ₹700.
 */
export const FIRST_ORDER_DISCOUNT_KIND = "first_order" as const;
export const FIRST_ORDER_DISCOUNT_BPS = 1000;

/** Order statuses that mean the order was not fulfilled — its discount is given back. */
export const RELEASING_STATUSES: readonly OrderStatus[] = [
  OrderStatus.cancelled,
  OrderStatus.refunded,
  OrderStatus.returned,
  OrderStatus.rto,
];

export type DiscountKeyKind = "phone" | "email" | "name_address";
export interface DiscountKey {
  kind: DiscountKeyKind;
  hash: string;
}

/** Lowercase, punctuation to spaces, whitespace collapsed — so "12, MG Road." and "12 mg road" match. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The claim keys for one customer, from the plaintext the checkout already holds (phone in E.164). */
export function discountKeys(input: {
  phone: string;
  email: string;
  name: string;
  line1: string;
  pincode: string;
}): DiscountKey[] {
  return [
    { kind: "phone", hash: keyedLookupHash(`phone:${input.phone}`) },
    { kind: "email", hash: keyedLookupHash(`email:${input.email.trim().toLowerCase()}`) },
    {
      kind: "name_address",
      hash: keyedLookupHash(`name_address:${normalize(input.name)}|${normalize(input.line1)}|${input.pincode}`),
    },
  ];
}

/** The same keys from the encrypted columns an address and a checkout session store. */
export function discountKeysFromEncrypted(input: {
  phoneEnc: string;
  nameEnc: string;
  line1Enc: string;
  pincode: string;
  contactEmailEnc: string;
}): DiscountKey[] {
  return discountKeys({
    phone: decryptField(input.phoneEnc),
    email: decryptField(input.contactEmailEnc),
    name: decryptField(input.nameEnc),
    line1: decryptField(input.line1Enc),
    pincode: input.pincode,
  });
}

type Client = Pick<Prisma.TransactionClient, "firstOrderDiscountClaim">;

/** True when none of the keys has a claim — a new customer. */
export async function isFirstOrder(client: Client, keys: readonly DiscountKey[]): Promise<boolean> {
  const claimed = await client.firstOrderDiscountClaim.count({
    where: { OR: keys.map((key) => ({ keyKind: key.kind, keyHash: key.hash })) },
  });
  return claimed === 0;
}

/**
 * Records the order's keys inside the capture transaction. Never throws on
 * a duplicate: the payment is already captured at the discounted amount,
 * so a concurrent first order sharing a key keeps its discount and is only
 * logged.
 */
export async function claimFirstOrderDiscount(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { keys: readonly DiscountKey[]; orderId: string },
): Promise<boolean> {
  let inserted = 0;
  for (const key of input.keys) {
    inserted += await tx.$executeRaw`
      INSERT INTO first_order_discount_claims (key_kind, key_hash, order_id)
      VALUES (${key.kind}, ${key.hash}, ${input.orderId}::uuid)
      ON CONFLICT (key_kind, key_hash) DO NOTHING
    `;
  }
  if (inserted < input.keys.length) {
    console.warn(
      `[discounts] order=${input.orderId} ${input.keys.length - inserted} discount key(s) already claimed; kept as charged`,
    );
  }
  return inserted === input.keys.length;
}

/** Gives an unfulfilled order's discount back; a no-op for an order that never had one. */
export async function releaseFirstOrderDiscount(
  tx: Pick<Prisma.TransactionClient, "firstOrderDiscountClaim">,
  orderId: string,
): Promise<number> {
  const { count } = await tx.firstOrderDiscountClaim.deleteMany({ where: { orderId } });
  if (count > 0) console.info(`[discounts] order=${orderId} released ${count} first-order discount key(s)`);
  return count;
}

/**
 * One line's share, rounded DOWN to whole rupees per line (10% of ₹6,999 is
 * ₹699 off). The order discount is the sum of these, never a rounded total.
 */
export function lineDiscountPaise(lineSubtotalPaise: number, rateBps: number): number {
  return Math.floor((lineSubtotalPaise * rateBps) / 10_000 / 100) * 100;
}
