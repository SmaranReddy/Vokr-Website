import { CheckoutPaymentMethod, OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { encryptField } from "@/server/checkout/crypto";
import {
  claimFirstOrderDiscount,
  FIRST_ORDER_DISCOUNT_KIND,
  isFirstOrderPhone,
  phoneHashFromEncrypted,
} from "@/server/discounts/first-order";
import { enqueueOrderConfirmation } from "@/server/email/outbox";
import type { PricingSnapshot } from "@/server/pricing";

import { assertValidOrderTransition } from "./state-machine";

/** Who changed an order: the verified payment path, or (Phase 12) a person. */
export const PAYMENT_ACTOR = "system:payment";

const ORDER_SOURCE_SELECT = {
  userId: true,
  paymentMethod: true,
  pricingSnapshot: true,
  contactEmailEnc: true,
  user: { select: { email: true } },
  address: {
    select: {
      nameEnc: true,
      phoneEnc: true,
      line1Enc: true,
      line2Enc: true,
      city: true,
      state: true,
      pincode: true,
      country: true,
    },
  },
} as const;

type OrderSourceRow = Prisma.CheckoutSessionGetPayload<{ select: typeof ORDER_SOURCE_SELECT }>;

/** A session that could not become a valid order — refused before any money can move. */
export class NotOrderableError extends Error {}

/**
 * Everything an order is built from, checked once: a snapshot whose lines
 * are complete (HSN included) and whose total is the amount to be
 * charged, an address, and a contact email. `createPaymentOrder` runs this
 * before a Razorpay order is ever created or handed out, so the in-capture
 * order creation below cannot fail on missing data and roll back a real
 * capture; the capture runs it again as a second line of defence.
 */
export function checkOrderSource(sessionId: string, row: OrderSourceRow, amountPaise: number) {
  const snapshot = row.pricingSnapshot as PricingSnapshot | null;
  const fail = (why: string): never => {
    throw new NotOrderableError(`session ${sessionId} cannot become an order: ${why}`);
  };
  if (!snapshot || !Array.isArray(snapshot.lines) || snapshot.lines.length === 0) fail("no priced lines");
  const lines = (snapshot as PricingSnapshot).lines;
  if (lines.some((line) => !line.hsnCode || !line.sku || !line.productName || line.quantity <= 0)) {
    fail("a priced line is incomplete");
  }
  if ((snapshot as PricingSnapshot).totalPaise !== amountPaise) {
    fail(`snapshot total ${(snapshot as PricingSnapshot).totalPaise} != amount ${amountPaise}`);
  }
  if (!row.address) fail("no address");
  const contactEmailEnc = row.contactEmailEnc ?? (row.user?.email ? encryptField(row.user.email) : null);
  if (!contactEmailEnc) fail("no contact email");
  return {
    snapshot: snapshot as PricingSnapshot,
    address: row.address as NonNullable<OrderSourceRow["address"]>,
    contactEmailEnc: contactEmailEnc as string,
  };
}

/** A discounted snapshot whose phone has since claimed its first-order discount — the customer must re-price. */
export class DiscountNoLongerAvailableError extends Error {}

/**
 * Loads and checks the order source; see {@link checkOrderSource}. Also
 * refuses a first-order discount whose phone was claimed after pricing
 * (another order on the same number), before any payment is handed out.
 */
export async function assertOrderable(
  client: Prisma.TransactionClient,
  sessionId: string,
  amountPaise: number,
): Promise<void> {
  const row = await client.checkoutSession.findUniqueOrThrow({ where: { id: sessionId }, select: ORDER_SOURCE_SELECT });
  const { snapshot, address } = checkOrderSource(sessionId, row, amountPaise);
  if ((snapshot.discountPaise ?? 0) > 0 && !(await isFirstOrderPhone(client, phoneHashFromEncrypted(address.phoneEnc)))) {
    throw new DiscountNoLongerAvailableError(`session ${sessionId}: first-order discount already claimed for this phone`);
  }
}

/**
 * Makes the order for a checkout session that has just become `paid`
 * (plan §5 Phase 9, task 3), inside the same transaction as that
 * transition — so a paid session and its order exist together or not at
 * all, and a replayed or concurrent capture can never make a second one
 * (`UNIQUE(checkout_session_id)`, `UNIQUE(payment_id)`; the caller holds
 * the session lock).
 *
 * Everything comes from the session's pricing snapshot and its address,
 * copied — encrypted fields stay encrypted, never decrypted here — and
 * nothing is recomputed, so the order's total is the amount charged.
 */
export async function createOrderForPaidSession(
  tx: Prisma.TransactionClient,
  input: { checkoutSessionId: string; paymentId: string; amountPaise: number },
): Promise<{ orderId: string; orderNumber: string }> {
  const session = await tx.checkoutSession.findUniqueOrThrow({
    where: { id: input.checkoutSessionId },
    select: ORDER_SOURCE_SELECT,
  });
  const { snapshot, address, contactEmailEnc } = checkOrderSource(input.checkoutSessionId, session, input.amountPaise);

  const order = await tx.order.create({
    data: {
      checkoutSessionId: input.checkoutSessionId,
      paymentId: input.paymentId,
      userId: session.userId,
      paymentMethod: session.paymentMethod ?? CheckoutPaymentMethod.prepaid,
      contactEmailEnc,
      shipNameEnc: address.nameEnc,
      shipPhoneEnc: address.phoneEnc,
      shipLine1Enc: address.line1Enc,
      shipLine2Enc: address.line2Enc,
      shipCity: address.city,
      shipState: address.state,
      shipPincode: address.pincode,
      shipCountry: address.country,
      gstSplit: snapshot.gstSplit,
      sellerState: snapshot.sellerState,
      subtotalPaise: snapshot.subtotalPaise,
      discountPaise: snapshot.discountPaise ?? 0,
      discountKind: (snapshot.discountPaise ?? 0) > 0 ? FIRST_ORDER_DISCOUNT_KIND : null,
      taxPaise: snapshot.taxPaise,
      shippingPaise: snapshot.shippingPaise,
      codFeePaise: snapshot.codFeePaise,
      totalPaise: snapshot.totalPaise,
      items: {
        create: snapshot.lines.map((line) => ({
          variantId: line.variantId,
          sku: line.sku,
          productName: line.productName,
          sizeLabel: line.sizeLabel,
          colorway: line.colorway,
          hsnCode: line.hsnCode,
          gstRateBps: line.gstRateBps,
          quantity: line.quantity,
          unitPricePaise: line.unitPricePaise,
          lineSubtotalPaise: line.lineSubtotalPaise,
          lineDiscountPaise: line.lineDiscountPaise ?? 0,
          lineTaxPaise: line.lineTaxPaise,
          cgstPaise: line.cgstPaise,
          sgstPaise: line.sgstPaise,
          igstPaise: line.igstPaise,
        })),
      },
      history: { create: { fromStatus: null, toStatus: OrderStatus.confirmed, actor: PAYMENT_ACTOR } },
    },
    select: { id: true, orderNumber: true },
  });
  if ((snapshot.discountPaise ?? 0) > 0) {
    await claimFirstOrderDiscount(tx, { phoneHash: phoneHashFromEncrypted(address.phoneEnc), orderId: order.id });
  }
  // The confirmation email's outbox row, in this same transaction: sent by
  // the maintenance job after commit, never inline (plan §5 Phase 11).
  await enqueueOrderConfirmation(tx, order.id);
  console.info(
    `[orders] order=${order.id} number=${order.orderNumber} created session=${input.checkoutSessionId} total=${snapshot.totalPaise}`,
  );
  return { orderId: order.id, orderNumber: order.orderNumber };
}

/**
 * Moves an order through the status machine and records it, under a row
 * lock so two writers serialise. Returns `false` when the order is
 * already there (a replay); throws on an illegal transition.
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  input: { orderId: string; to: OrderStatus; actor: string; note?: string },
): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ status: OrderStatus }[]>`
    SELECT status FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE
  `;
  if (!row) throw new Error(`order ${input.orderId} not found`);
  if (row.status === input.to) return false;
  assertValidOrderTransition(input.orderId, row.status, input.to);
  await tx.order.update({ where: { id: input.orderId }, data: { status: input.to }, select: { id: true } });
  await tx.orderStatusHistory.create({
    data: { orderId: input.orderId, fromStatus: row.status, toStatus: input.to, actor: input.actor, note: input.note },
    select: { id: true },
  });
  console.info(`[orders] order=${input.orderId} transition ${row.status} -> ${input.to} actor=${input.actor}`);
  return true;
}
