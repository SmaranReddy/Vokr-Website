import { decryptField } from "@/server/checkout/crypto";
import { prisma } from "@/server/db/client";

import { PERSONAL_DATA_INVENTORY } from "./inventory";

/**
 * Data-subject export for a signed-in customer (plan §5 Phase 17, task 4;
 * DPDP). Everything this system holds about the account, decrypted, as one
 * JSON document returned directly to the authenticated caller — nothing is
 * stored, so there is no archive or link to expire or leak.
 *
 * Guests own data only through a device session and an order number +
 * email; a verified guest export is not built (see the data inventory).
 */

export const EXPORT_FORMAT_VERSION = 1;

const decrypt = (value: string | null | undefined) => (value ? decryptField(value) : null);

export async function exportAccountData(userId: string, now: Date = new Date()) {
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, phoneEnc: true, createdAt: true },
  });
  if (!user) throw new Error(`no app user ${userId}`);

  const [addresses, carts, checkoutSessions, orders] = await Promise.all([
    prisma.address.findMany({
      where: { userId },
      select: {
        id: true,
        nameEnc: true,
        line1Enc: true,
        line2Enc: true,
        phoneEnc: true,
        city: true,
        state: true,
        pincode: true,
        country: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cart.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        items: { select: { quantity: true, variant: { select: { sku: true, sizeLabel: true, colorway: true, product: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.checkoutSession.findMany({
      where: { userId },
      select: { id: true, state: true, paymentMethod: true, contactEmailEnc: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.findMany({
      where: { userId },
      select: {
        orderNumber: true,
        status: true,
        paymentMethod: true,
        placedAt: true,
        contactEmailEnc: true,
        shipNameEnc: true,
        shipPhoneEnc: true,
        shipLine1Enc: true,
        shipLine2Enc: true,
        shipCity: true,
        shipState: true,
        shipPincode: true,
        shipCountry: true,
        subtotalPaise: true,
        discountPaise: true,
        taxPaise: true,
        shippingPaise: true,
        codFeePaise: true,
        totalPaise: true,
        courier: true,
        awb: true,
        shippedAt: true,
        items: {
          select: { sku: true, productName: true, sizeLabel: true, colorway: true, quantity: true, unitPricePaise: true, lineSubtotalPaise: true, lineDiscountPaise: true },
          orderBy: { id: "asc" },
        },
        history: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        payment: { select: { status: true, amountPaise: true, currency: true, providerPaymentId: true, createdAt: true } },
        emails: { select: { template: true, status: true, sentAt: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { placedAt: "asc" },
    }),
  ]);

  return {
    format: "vokr-personal-data-export",
    version: EXPORT_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    account: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      phone: decrypt(user.phoneEnc),
      createdAt: user.createdAt.toISOString(),
    },
    addresses: addresses.map((address) => ({
      id: address.id,
      name: decrypt(address.nameEnc),
      line1: decrypt(address.line1Enc),
      line2: decrypt(address.line2Enc),
      phone: decrypt(address.phoneEnc),
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
      createdAt: address.createdAt.toISOString(),
    })),
    bags: carts.map((cart) => ({
      id: cart.id,
      status: cart.status,
      createdAt: cart.createdAt.toISOString(),
      updatedAt: cart.updatedAt.toISOString(),
      items: cart.items.map((item) => ({
        product: item.variant.product.name,
        sku: item.variant.sku,
        size: item.variant.sizeLabel,
        colour: item.variant.colorway,
        quantity: item.quantity,
      })),
    })),
    checkouts: checkoutSessions.map((session) => ({
      id: session.id,
      state: session.state,
      paymentMethod: session.paymentMethod,
      contactEmail: decrypt(session.contactEmailEnc),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    })),
    orders: orders.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      placedAt: order.placedAt.toISOString(),
      contactEmail: decrypt(order.contactEmailEnc),
      shipTo: {
        name: decrypt(order.shipNameEnc),
        phone: decrypt(order.shipPhoneEnc),
        line1: decrypt(order.shipLine1Enc),
        line2: decrypt(order.shipLine2Enc),
        city: order.shipCity,
        state: order.shipState,
        pincode: order.shipPincode,
        country: order.shipCountry,
      },
      items: order.items,
      totals: {
        subtotalPaise: order.subtotalPaise,
        discountPaise: order.discountPaise,
        taxPaise: order.taxPaise,
        shippingPaise: order.shippingPaise,
        codFeePaise: order.codFeePaise,
        totalPaise: order.totalPaise,
      },
      shipment: order.awb ? { courier: order.courier, awb: order.awb, shippedAt: order.shippedAt?.toISOString() ?? null } : null,
      statusHistory: order.history.map((row) => ({ status: row.toStatus, at: row.createdAt.toISOString() })),
      payment: order.payment
        ? {
            status: order.payment.status,
            amountPaise: order.payment.amountPaise,
            currency: order.payment.currency,
            razorpayPaymentId: order.payment.providerPaymentId,
            createdAt: order.payment.createdAt.toISOString(),
          }
        : null,
      emails: order.emails.map((email) => ({
        template: email.template,
        status: email.status,
        sentAt: email.sentAt?.toISOString() ?? null,
        queuedAt: email.createdAt.toISOString(),
      })),
    })),
    notExported: PERSONAL_DATA_INVENTORY.filter((entry) => entry.exported !== true).map((entry) => ({
      field: entry.field,
      what: entry.what,
      why: entry.exported,
    })),
  };
}
