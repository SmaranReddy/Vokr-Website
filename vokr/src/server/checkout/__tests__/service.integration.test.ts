import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CheckoutState } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import { addItem } from "@/server/cart";
import {
  createActiveVariantFixture,
  deleteVariantFixture,
} from "@/server/cart/__tests__/fixtures";
import { prisma } from "@/server/db/client";

import {
  createCheckoutSession,
  priceCheckoutSession,
  setCheckoutAddress,
} from "../service";

/**
 * Requires a running Postgres with migrations applied, and the Phase 6
 * local-test env fixtures in `.env.local` (`ADDRESS_ENCRYPTION_KEY`,
 * `CHECKOUT_SELLER_STATE`) — see README.md and that file's own comment:
 * a test fixture, not the real answer to D3. Shipping fees come from
 * `serviceable_pincodes`, seeded below.
 * Run via `npm run test:integration`.
 */

const createdGuestSessionIds: string[] = [];
const createdProductIds: string[] = [];

async function guestIdentity(): Promise<Identity> {
  const guestSessionId = randomUUID();
  await prisma.guestSession.create({
    data: {
      id: guestSessionId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  createdGuestSessionIds.push(guestSessionId);
  return { type: "guest", guestSessionId };
}

const SHIPPING_FEE_PAISE = 9_900;

/** The delivery PIN code needs a fee on file, or pricing refuses it. */
beforeAll(async () => {
  await prisma.serviceablePincode.upsert({
    where: { pincode: "400001" },
    create: { pincode: "400001", codEligible: false, estimatedDeliveryDays: 4, shippingFeePaise: SHIPPING_FEE_PAISE },
    update: { shippingFeePaise: SHIPPING_FEE_PAISE },
  });
});

afterAll(async () => {
  await prisma.serviceablePincode.deleteMany({ where: { pincode: "400001" } });
});

const validAddress = {
  name: "Asha Rao",
  phone: "+919876543210",
  line1: "12 MG Road",
  line2: undefined,
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  email: "asha@example.com",
};

afterEach(async () => {
  const sessions = await prisma.checkoutSession.findMany({
    where: { guestSessionId: { in: createdGuestSessionIds } },
    select: { id: true, addressId: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const addressIds = sessions.map((s) => s.addressId).filter((id): id is string => !!id);
  if (sessionIds.length > 0) {
    await prisma.checkoutSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  if (addressIds.length > 0) {
    await prisma.address.deleteMany({ where: { id: { in: addressIds } } });
  }

  const carts = await prisma.cart.findMany({
    where: { guestSessionId: { in: createdGuestSessionIds } },
    select: { id: true },
  });
  const cartIds = carts.map((c) => c.id);
  if (cartIds.length > 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } });
    await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
  }

  await prisma.guestSession.deleteMany({ where: { id: { in: createdGuestSessionIds } } });
  for (const productId of createdProductIds) {
    await deleteVariantFixture(productId);
  }
  createdGuestSessionIds.length = 0;
  createdProductIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkout service (plan §5 Phase 6)", () => {
  it("createCheckoutSession is idempotent: the same key returns the same session, never a second one (task 10)", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Checkout Shoe",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });

    const key = randomUUID();
    const first = await createCheckoutSession(identity, key);
    const second = await createCheckoutSession(identity, key);

    expect(second.id).toBe(first.id);
    const count = await prisma.checkoutSession.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("createCheckoutSession rejects an empty cart", async () => {
    const identity = await guestIdentity();
    await expect(createCheckoutSession(identity, randomUUID())).rejects.toThrow(
      ValidationError,
    );
  });

  it("setCheckoutAddress encrypts PII at rest — the raw row never contains the plaintext name, phone or line1", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Encrypt",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });

    const session = await createCheckoutSession(identity, randomUUID());
    const updated = await setCheckoutAddress(identity, session.id, validAddress);

    expect(updated.address).toMatchObject({ name: "Asha Rao", phone: "+919876543210" });
    expect(updated.state).toBe(CheckoutState.address_captured);

    const row = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { address: { select: { nameEnc: true, phoneEnc: true, line1Enc: true } } },
    });
    expect(row.address!.nameEnc).not.toContain("Asha Rao");
    expect(row.address!.phoneEnc).not.toContain("9876543210");
    expect(row.address!.line1Enc).not.toContain("MG Road");
  });

  it("a guest must give an email for order updates; it is stored encrypted and read back", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Email",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });
    const session = await createCheckoutSession(identity, randomUUID());

    const withoutEmail = { ...validAddress, email: undefined };
    await expect(setCheckoutAddress(identity, session.id, withoutEmail)).rejects.toThrow(ValidationError);

    const updated = await setCheckoutAddress(identity, session.id, validAddress);
    expect(updated.contactEmail).toBe("asha@example.com");
    const row = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { contactEmailEnc: true },
    });
    expect(row.contactEmailEnc).toBeTruthy();
    expect(row.contactEmailEnc).not.toContain("asha");
  });

  it("another identity's checkout session is inaccessible (404, not a distinguishable 403)", async () => {
    const owner = await guestIdentity();
    const stranger = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test IDOR Checkout",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(owner, { variantId: fixture.variantId, quantity: 1 });

    const session = await createCheckoutSession(owner, randomUUID());

    await expect(
      setCheckoutAddress(stranger, session.id, validAddress),
    ).rejects.toThrow(NotFoundError);
  });

  it("priceCheckoutSession requires an address first", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test No Address",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });
    const session = await createCheckoutSession(identity, randomUUID());

    await expect(priceCheckoutSession(identity, session.id, "prepaid")).rejects.toThrow(
      ValidationError,
    );
  });

  it("priceCheckoutSession persists the snapshot, expiry and payment method, and transitions to priced", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Priced",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });
    const session = await createCheckoutSession(identity, randomUUID());
    await setCheckoutAddress(identity, session.id, validAddress);

    const priced = await priceCheckoutSession(identity, session.id, "prepaid");

    expect(priced.state).toBe(CheckoutState.priced);
    expect(priced.paymentMethod).toBe("prepaid");
    expect(priced.pricingSnapshot).not.toBeNull();
    // Shipping is the delivery PIN code's fee, on every order; no COD fee exists.
    expect(priced.pricingSnapshot!.shippingPaise).toBe(SHIPPING_FEE_PAISE);
    expect(priced.pricingSnapshot!.codFeePaise).toBe(0);
    expect(priced.expiresAt).not.toBeNull();

    const row = await prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { pricingSnapshot: true, expiresAt: true },
    });
    expect(row.pricingSnapshot).not.toBeNull();
    expect(row.expiresAt).not.toBeNull();
  });

  it("setCheckoutAddress rejects a change once the session has been priced", async () => {
    const identity = await guestIdentity();
    const fixture = await createActiveVariantFixture({
      name: "Test Locked Address",
      category: "footwear",
      gstRateBps: 1800,
      pricePaise: 999_500,
    });
    createdProductIds.push(fixture.productId);
    await addItem(identity, { variantId: fixture.variantId, quantity: 1 });
    const session = await createCheckoutSession(identity, randomUUID());
    await setCheckoutAddress(identity, session.id, validAddress);
    await priceCheckoutSession(identity, session.id, "prepaid");

    await expect(
      setCheckoutAddress(identity, session.id, { ...validAddress, city: "Pune" }),
    ).rejects.toThrow(ConflictError);
  });
});
