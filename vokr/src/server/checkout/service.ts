import { CheckoutState } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { discountKeysFromEncrypted, isFirstOrder } from "@/server/discounts/first-order";
import {
  computePricing,
  type CheckoutPaymentMethod,
  type PricingSnapshot,
} from "@/server/pricing";

import type { AddressBody } from "./schemas";
import { assertValidCheckoutTransition } from "./state-machine";
import { decryptField, encryptField } from "./crypto";

export interface CheckoutSessionView {
  id: string;
  state: CheckoutState;
  cartId: string;
  address: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  } | null;
  paymentMethod: CheckoutPaymentMethod | null;
  pricingSnapshot: PricingSnapshot | null;
  expiresAt: string | null;
  /** Where order updates go; a guest's own, or a signed-in customer's account email. */
  contactEmail: string | null;
}

/** The `where` shape that names one identity's rows — never both columns at once (same convention as `server/cart/service.ts`). */
function identityWhere(
  identity: Identity,
): { userId: string } | { guestSessionId: string } {
  return identity.type === "user"
    ? { userId: identity.userId }
    : { guestSessionId: identity.guestSessionId };
}

function identityOwnsSession(
  identity: Identity,
  session: { userId: string | null; guestSessionId: string | null },
): boolean {
  return identity.type === "user"
    ? session.userId === identity.userId
    : session.guestSessionId === identity.guestSessionId;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

interface SessionRow {
  id: string;
  cartId: string;
  userId: string | null;
  guestSessionId: string | null;
  state: CheckoutState;
  paymentMethod: CheckoutPaymentMethod | null;
  pricingSnapshot: Prisma.JsonValue | null;
  expiresAt: Date | null;
  contactEmailEnc: string | null;
  address: {
    nameEnc: string;
    phoneEnc: string;
    line1Enc: string;
    line2Enc: string | null;
    city: string;
    state: string;
    pincode: string;
  } | null;
}

const SESSION_SELECT = {
  id: true,
  cartId: true,
  userId: true,
  guestSessionId: true,
  state: true,
  paymentMethod: true,
  pricingSnapshot: true,
  expiresAt: true,
  contactEmailEnc: true,
  address: {
    select: {
      nameEnc: true,
      phoneEnc: true,
      line1Enc: true,
      line2Enc: true,
      city: true,
      state: true,
      pincode: true,
    },
  },
} as const;

/** Throws {@link NotFoundError} for a missing session *or another identity's session* — the two cases must be indistinguishable to the caller (plan §5 Phase 6, Security Requirements). */
export async function findOwnedSession(
  identity: Identity,
  sessionId: string,
): Promise<SessionRow> {
  const session = await prisma.checkoutSession.findUnique({
    where: { id: sessionId },
    select: SESSION_SELECT,
  });
  if (!session || !identityOwnsSession(identity, session)) {
    throw new NotFoundError("Checkout session not found.");
  }
  return session;
}

function toView(session: SessionRow): CheckoutSessionView {
  return {
    id: session.id,
    state: session.state,
    cartId: session.cartId,
    address: session.address
      ? {
          name: decryptField(session.address.nameEnc),
          phone: decryptField(session.address.phoneEnc),
          line1: decryptField(session.address.line1Enc),
          line2: session.address.line2Enc
            ? decryptField(session.address.line2Enc)
            : null,
          city: session.address.city,
          state: session.address.state,
          pincode: session.address.pincode,
        }
      : null,
    paymentMethod: session.paymentMethod,
    pricingSnapshot: session.pricingSnapshot as PricingSnapshot | null,
    expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
    contactEmail: session.contactEmailEnc ? decryptField(session.contactEmailEnc) : null,
  };
}

/**
 * Idempotent session creation (plan §5 Phase 6, task 10): the same
 * `idempotencyKey` always resolves to the same session, enforced by the
 * unique constraint on `checkout_sessions.idempotency_key`, not just an
 * application-level check. Requires an open, non-empty cart — checkout
 * has nothing to price otherwise.
 */
export async function createCheckoutSession(
  identity: Identity,
  idempotencyKey: string,
): Promise<CheckoutSessionView> {
  const existing = await prisma.checkoutSession.findUnique({
    where: { idempotencyKey },
    select: SESSION_SELECT,
  });
  if (existing) {
    if (!identityOwnsSession(identity, existing)) {
      throw new ConflictError("Idempotency key already used by another session.");
    }
    return toView(existing);
  }

  const cart = await prisma.cart.findFirst({
    where: { ...identityWhere(identity), status: "open" },
    select: { id: true, items: { select: { id: true }, take: 1 } },
  });
  if (!cart || cart.items.length === 0) {
    throw new ValidationError("Cannot start checkout with an empty cart.");
  }

  try {
    const created = await prisma.checkoutSession.create({
      data: {
        cartId: cart.id,
        idempotencyKey,
        ...identityWhere(identity),
      },
      select: SESSION_SELECT,
    });
    console.info(`[checkout] session=${created.id} created state=draft`);
    return toView(created);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raceWinner = await prisma.checkoutSession.findUnique({
        where: { idempotencyKey },
        select: SESSION_SELECT,
      });
      if (raceWinner && identityOwnsSession(identity, raceWinner)) {
        return toView(raceWinner);
      }
    }
    throw error;
  }
}

export async function getCheckoutSession(
  identity: Identity,
  sessionId: string,
): Promise<CheckoutSessionView> {
  return toView(await findOwnedSession(identity, sessionId));
}

/**
 * Sets (or re-sets, before pricing) the session's address. Re-submission
 * while still in `address_captured` overwrites the same row in place —
 * there is no saved address book to preserve history against (plan §5
 * Phase 6, Explicitly Out of Scope). Once a session has moved past
 * `address_captured` (priced or later), the address is locked — the
 * pricing snapshot it produced would otherwise silently disagree with a
 * changed ship-to state.
 */
export async function setCheckoutAddress(
  identity: Identity,
  sessionId: string,
  body: AddressBody,
): Promise<CheckoutSessionView> {
  const session = await findOwnedSession(identity, sessionId);

  if (
    session.state !== CheckoutState.draft &&
    session.state !== CheckoutState.address_captured
  ) {
    throw new ConflictError(
      `Address cannot be changed once the session has moved to "${session.state}".`,
    );
  }

  // A guest's email is the second factor of order lookup and where order
  // updates go, so it is required; a signed-in customer may give another,
  // and otherwise their account's is used.
  let contactEmail: string;
  if (body.email) {
    contactEmail = body.email;
  } else if (identity.type === "user") {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: identity.userId },
      select: { email: true },
    });
    contactEmail = user.email;
  } else {
    throw new ValidationError("Add an email address for your order updates.");
  }

  const encrypted = {
    nameEnc: encryptField(body.name),
    phoneEnc: encryptField(body.phone),
    line1Enc: encryptField(body.line1),
    line2Enc: body.line2 ? encryptField(body.line2) : null,
    city: body.city,
    state: body.state,
    pincode: body.pincode,
  };

  await prisma.$transaction(async (tx) => {
    const existingAddressId = await tx.checkoutSession
      .findUnique({ where: { id: sessionId }, select: { addressId: true } })
      .then((row) => row?.addressId ?? null);

    const addressId = existingAddressId
      ? (
          await tx.address.update({
            where: { id: existingAddressId },
            data: encrypted,
            select: { id: true },
          })
        ).id
      : (
          await tx.address.create({
            data: {
              ...encrypted,
              userId: identity.type === "user" ? identity.userId : null,
            },
            select: { id: true },
          })
        ).id;

    if (session.state === CheckoutState.draft) {
      assertValidCheckoutTransition(
        sessionId,
        CheckoutState.draft,
        CheckoutState.address_captured,
      );
    }

    await tx.checkoutSession.update({
      where: { id: sessionId },
      data: {
        addressId,
        state: CheckoutState.address_captured,
        contactEmailEnc: encryptField(contactEmail),
      },
      select: { id: true },
    });
  });

  return getCheckoutSession(identity, sessionId);
}

/**
 * Computes (or refreshes) the pricing snapshot and persists it — the
 * only place `checkout_sessions.pricing_snapshot` / `expires_at` /
 * `payment_method` are written (plan §5 Phase 6, task 7). Safe to call
 * repeatedly: each call re-derives the snapshot from the current cart and
 * address rather than trusting the previous one, and extends
 * `expires_at` — a customer sitting on the review step keeps a live
 * snapshot rather than hitting a stale-price error on submit.
 */
export async function priceCheckoutSession(
  identity: Identity,
  sessionId: string,
  paymentMethod: CheckoutPaymentMethod,
): Promise<CheckoutSessionView> {
  const session = await findOwnedSession(identity, sessionId);

  if (!session.address || !session.contactEmailEnc) {
    throw new ValidationError("Add a shipping address before pricing.");
  }
  if (
    session.state !== CheckoutState.address_captured &&
    session.state !== CheckoutState.priced
  ) {
    throw new ConflictError(
      `Checkout session cannot be priced from state "${session.state}".`,
    );
  }

  const snapshot = await computePricing({
    cartId: session.cartId,
    shipToState: session.address.state,
    paymentMethod,
    firstOrderDiscount: await isFirstOrder(
      prisma,
      discountKeysFromEncrypted({ ...session.address, contactEmailEnc: session.contactEmailEnc }),
    ),
  });

  if (session.state === CheckoutState.address_captured) {
    assertValidCheckoutTransition(
      sessionId,
      CheckoutState.address_captured,
      CheckoutState.priced,
    );
  }

  await prisma.checkoutSession.update({
    where: { id: sessionId },
    data: {
      state: CheckoutState.priced,
      paymentMethod,
      pricingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(snapshot.expiresAt),
    },
    select: { id: true },
  });

  return getCheckoutSession(identity, sessionId);
}
