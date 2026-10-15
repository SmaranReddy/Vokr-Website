import { CheckoutPaymentMethod, OrderStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { encryptField } from "@/server/checkout/crypto";
import type { PricingSnapshot } from "@/server/pricing";

import { assertValidOrderTransition } from "./state-machine";

/** Who changed an order: the verified payment path, or (Phase 12) a person. */
export const PAYMENT_ACTOR = "system:payment";

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
    select: {
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
    },
  });

  const snapshot = session.pricingSnapshot as PricingSnapshot | null;
  if (!snapshot || !session.address) {
    throw new Error(`session ${input.checkoutSessionId} is paid but has no snapshot or address`);
  }
  // The payment row's amount was copied from this snapshot when the order
  // was claimed; if they differ something upstream is broken, and an order
  // that disagrees with the charge must not exist.
  if (snapshot.totalPaise !== input.amountPaise) {
    throw new Error(
      `session ${input.checkoutSessionId} snapshot total ${snapshot.totalPaise} != payment ${input.amountPaise}`,
    );
  }
  const contactEmailEnc =
    session.contactEmailEnc ?? (session.user?.email ? encryptField(session.user.email) : null);
  if (!contactEmailEnc) {
    throw new Error(`session ${input.checkoutSessionId} is paid but has no contact email`);
  }

  const order = await tx.order.create({
    data: {
      checkoutSessionId: input.checkoutSessionId,
      paymentId: input.paymentId,
      userId: session.userId,
      paymentMethod: session.paymentMethod ?? CheckoutPaymentMethod.prepaid,
      contactEmailEnc,
      shipNameEnc: session.address.nameEnc,
      shipPhoneEnc: session.address.phoneEnc,
      shipLine1Enc: session.address.line1Enc,
      shipLine2Enc: session.address.line2Enc,
      shipCity: session.address.city,
      shipState: session.address.state,
      shipPincode: session.address.pincode,
      shipCountry: session.address.country,
      gstSplit: snapshot.gstSplit,
      sellerState: snapshot.sellerState,
      subtotalPaise: snapshot.subtotalPaise,
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
