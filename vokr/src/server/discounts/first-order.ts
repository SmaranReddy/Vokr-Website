import type { Prisma } from "@/generated/prisma/client";
import { decryptField, phoneLookupHash } from "@/server/checkout/crypto";

/**
 * 10% off the products of a phone number's first order (owner decision,
 * 21 Oct 2026). "First" means no order has claimed the number yet in
 * `first_order_discount_claims`; a cancelled or refunded order keeps its
 * claim. The phone is the ship-to number, unverified, so a customer with a
 * second number gets the discount again — that is the rule as given.
 *
 * Not applied to shipping or the COD fee. Free shipping is judged on the
 * subtotal after the discount (what the customer actually pays for goods).
 */
export const FIRST_ORDER_DISCOUNT_KIND = "first_order" as const;
export const FIRST_ORDER_DISCOUNT_BPS = 1000;

type Client = Pick<Prisma.TransactionClient, "firstOrderDiscountClaim">;

/** The claim key for an encrypted (E.164) phone, as stored on an address. */
export function phoneHashFromEncrypted(phoneEnc: string): string {
  return phoneLookupHash(decryptField(phoneEnc));
}

export async function isFirstOrderPhone(client: Client, phoneHash: string): Promise<boolean> {
  const claimed = await client.firstOrderDiscountClaim.findUnique({
    where: { phoneHash },
    select: { phoneHash: true },
  });
  return claimed === null;
}

/**
 * Records the claim with the order, inside the capture transaction. Never
 * throws on a duplicate: the payment is already captured at the discounted
 * amount, so a concurrent first order on the same number (both priced
 * before either claimed) keeps its discount and is only logged.
 */
export async function claimFirstOrderDiscount(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: { phoneHash: string; orderId: string },
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO first_order_discount_claims (phone_hash, order_id)
    VALUES (${input.phoneHash}, ${input.orderId}::uuid)
    ON CONFLICT (phone_hash) DO NOTHING
  `;
  if (inserted === 0) {
    console.warn(`[discounts] order=${input.orderId} first-order discount already claimed for this phone; kept as charged`);
  }
  return inserted > 0;
}

/**
 * One line's share, rounded half-up to whole rupees per line (10% of
 * ₹6,999 is ₹700 off, not ₹699.90) — every price the store shows and
 * charges stays a whole rupee. The order discount is the sum of these,
 * never a rounded total.
 */
export function lineDiscountPaise(lineSubtotalPaise: number, rateBps: number): number {
  return Math.round((lineSubtotalPaise * rateBps) / 10_000 / 100) * 100;
}
