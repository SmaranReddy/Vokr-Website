import { CartStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Identity } from "@/server/auth/session";
import type { TransactionClient } from "@/server/auth/upgrade";
import {
  type CatalogProduct,
  type CatalogVariant,
  getVariantById,
  listProducts,
} from "@/server/catalog";
import { MAX_CART_ITEM_QUANTITY, MIN_CART_ITEM_QUANTITY } from "@/lib/cart";
import { prisma } from "@/server/db/client";

export { MAX_CART_ITEM_QUANTITY, MIN_CART_ITEM_QUANTITY };

/** A cart line whose variant no longer resolves to a purchasable catalog entry carries no price — it exists only so the caller can remove it. */
export type CartLine =
  | {
      cartItemId: string;
      variantId: string;
      quantity: number;
      available: true;
      sku: string;
      productSlug: string;
      productName: string;
      sizeLabel: string;
      colorway: string;
      /** GST-inclusive, per unit — `terms.html`'s published "GST-inclusive pricing" commitment. */
      unitPricePaise: number;
      lineSubtotalPaise: number;
      gstRateBps: number;
      /** The GST embedded within `lineSubtotalPaise` — a breakdown, not an addition (price is already inclusive). */
      lineTaxPaise: number;
      quantityAvailable: number;
      inStock: boolean;
    }
  | {
      cartItemId: string;
      variantId: string;
      quantity: number;
      available: false;
    };

export interface CartView {
  cartId: string | null;
  items: CartLine[];
  /** Sum of `lineSubtotalPaise` over available lines only. */
  subtotalPaise: number;
  /** Sum of `lineTaxPaise` over available lines only — informational; already included in `subtotalPaise`. */
  taxPaise: number;
  /** Equal to `subtotalPaise`: GST-inclusive pricing means nothing is added on top. */
  totalPaise: number;
}

function emptyCartView(): CartView {
  return { cartId: null, items: [], subtotalPaise: 0, taxPaise: 0, totalPaise: 0 };
}

function assertValidQuantity(quantity: number): void {
  if (
    !Number.isInteger(quantity) ||
    quantity < MIN_CART_ITEM_QUANTITY ||
    quantity > MAX_CART_ITEM_QUANTITY
  ) {
    throw new ValidationError(
      `quantity must be an integer between ${MIN_CART_ITEM_QUANTITY} and ${MAX_CART_ITEM_QUANTITY}.`,
    );
  }
}

/** The `where` shape that names one identity's carts — never both columns at once. */
function identityCartWhere(
  identity: Identity,
): { userId: string } | { guestSessionId: string } {
  return identity.type === "user"
    ? { userId: identity.userId }
    : { guestSessionId: identity.guestSessionId };
}

function identityOwnsCart(
  identity: Identity,
  cart: { userId: string | null; guestSessionId: string | null },
): boolean {
  return identity.type === "user"
    ? cart.userId === identity.userId
    : cart.guestSessionId === identity.guestSessionId;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Finds the caller's open cart id, creating one if none exists. The
 * partial unique index added in the Phase 5 migration is the actual
 * guarantee of "one open cart per identity" — this function's `catch` is
 * just what makes a race for the very first cart lose gracefully instead
 * of surfacing a raw constraint-violation error to the caller.
 */
export async function getOrCreateOpenCartId(
  tx: TransactionClient,
  who: { userId: string } | { guestSessionId: string },
): Promise<string> {
  const existing = await tx.cart.findFirst({
    where: { ...who, status: CartStatus.open },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }

  try {
    const created = await tx.cart.create({
      data: { ...who },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raceWinner = await tx.cart.findFirst({
        where: { ...who, status: CartStatus.open },
        select: { id: true },
      });
      if (raceWinner) {
        return raceWinner.id;
      }
    }
    throw error;
  }
}

async function findOpenCart(
  tx: TransactionClient,
  identity: Identity,
): Promise<{ id: string } | null> {
  return tx.cart.findFirst({
    where: { ...identityCartWhere(identity), status: CartStatus.open },
    select: { id: true },
  });
}

interface OwnedCartItem {
  id: string;
  cartId: string;
  variantId: string;
}

/** Throws {@link NotFoundError} for a missing item, a closed cart, or another identity's cart — the three cases must be indistinguishable to the caller (no existence disclosure). */
async function findOwnedOpenCartItem(
  tx: TransactionClient,
  identity: Identity,
  cartItemId: string,
): Promise<OwnedCartItem> {
  const item = await tx.cartItem.findUnique({
    where: { id: cartItemId },
    select: {
      id: true,
      cartId: true,
      variantId: true,
      cart: {
        select: { userId: true, guestSessionId: true, status: true },
      },
    },
  });

  if (
    !item ||
    item.cart.status !== CartStatus.open ||
    !identityOwnsCart(identity, item.cart)
  ) {
    throw new NotFoundError("Cart item not found.");
  }

  return { id: item.id, cartId: item.cartId, variantId: item.variantId };
}

/** Bumps `updated_at` so abandoned-cart pruning (task 8) measures real activity, not just cart creation. */
export async function touchCart(
  cartId: string,
  tx: TransactionClient,
): Promise<void> {
  await tx.cart.update({
    where: { id: cartId },
    data: { status: CartStatus.open },
    select: { id: true },
  });
}

function findVariantInCatalog(
  catalog: readonly CatalogProduct[],
  variantId: string,
): { product: CatalogProduct; variant: CatalogVariant } | undefined {
  for (const product of catalog) {
    const variant = product.variants.find(
      (candidate) => candidate.id === variantId && candidate.isPurchasable,
    );
    if (variant) {
      return { product, variant };
    }
  }
  return undefined;
}

/** The only place a `cart_items` row is turned into money — every field here is server-resolved, never read from the row itself (R6). */
function buildAvailableLine(
  cartItemId: string,
  quantity: number,
  product: CatalogProduct,
  variant: CatalogVariant,
): CartLine {
  if (product.gstRateBps === null) {
    // Structurally unreachable: the `enforce_variant_gst_rate` trigger
    // refuses to activate a variant on a product with no GST rate, and
    // `isPurchasable` requires active status. A thrown error here is
    // preferable to inventing a rate (AGENTS.md "Do not invent GST or
    // HSN values").
    throw new Error(
      `cart: purchasable variant ${variant.id} belongs to product ${product.id}, which has no gst_rate_bps.`,
    );
  }

  const lineSubtotalPaise = variant.pricePaise * quantity;
  // GST-inclusive pricing (terms.html): the tax is embedded in
  // `pricePaise`, not added on top. Backed out at the line level, half-up
  // — Vokr-Implementation-Plan.md §5 Phase 6 fixes this rounding
  // convention and Phase 5 follows it for the same per-variant figures.
  const lineTaxPaise = Math.round(
    (lineSubtotalPaise * product.gstRateBps) / (10_000 + product.gstRateBps),
  );

  return {
    cartItemId,
    variantId: variant.id,
    quantity,
    available: true,
    sku: variant.sku,
    productSlug: product.slug,
    productName: product.name,
    sizeLabel: variant.sizeLabel,
    colorway: variant.colorway,
    unitPricePaise: variant.pricePaise,
    lineSubtotalPaise,
    gstRateBps: product.gstRateBps,
    lineTaxPaise,
    quantityAvailable: variant.quantityAvailable,
    inStock: variant.quantityAvailable >= quantity,
  };
}

async function buildCartView(
  cartId: string,
  tx: TransactionClient,
): Promise<CartView> {
  const rows = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: { addedAt: "asc" },
    select: { id: true, variantId: true, quantity: true },
  });

  const catalog = await listProducts();

  const items: CartLine[] = rows.map((row) => {
    const found = findVariantInCatalog(catalog, row.variantId);
    if (!found) {
      return {
        cartItemId: row.id,
        variantId: row.variantId,
        quantity: row.quantity,
        available: false,
      };
    }
    return buildAvailableLine(row.id, row.quantity, found.product, found.variant);
  });

  let subtotalPaise = 0;
  let taxPaise = 0;
  for (const item of items) {
    if (item.available) {
      subtotalPaise += item.lineSubtotalPaise;
      taxPaise += item.lineTaxPaise;
    }
  }

  return { cartId, items, subtotalPaise, taxPaise, totalPaise: subtotalPaise };
}

/** Never creates a cart on a mere read — an anonymous visitor who never adds anything never gets a database row. */
export async function getCart(identity: Identity): Promise<CartView> {
  const cart = await findOpenCart(prisma, identity);
  if (!cart) {
    return emptyCartView();
  }
  return buildCartView(cart.id, prisma);
}

export interface AddItemParams {
  variantId: string;
  quantity: number;
}

/** Validates existence, purchasability and advisory stock before ever touching `cart_items` (plan §5 Phase 5, task 4). */
export async function addItem(
  identity: Identity,
  { variantId, quantity }: AddItemParams,
): Promise<CartView> {
  assertValidQuantity(quantity);

  // Throws NotFoundError for an unknown or not-currently-purchasable
  // variant — the existing catalog contract (R6), reused rather than
  // duplicated.
  const variant = await getVariantById(variantId);
  if (variant.quantityAvailable < quantity) {
    throw new ConflictError(
      "Not enough stock available for this variant.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const cartId = await getOrCreateOpenCartId(tx, identityCartWhere(identity));

    const existing = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
      select: { id: true, quantity: true },
    });

    if (existing) {
      const mergedQuantity = Math.min(
        existing.quantity + quantity,
        MAX_CART_ITEM_QUANTITY,
      );
      await tx.cartItem.update({
        where: { id: existing.id },
        data: { quantity: mergedQuantity },
        select: { id: true },
      });
    } else {
      await tx.cartItem.create({
        data: { cartId, variantId, quantity },
        select: { id: true },
      });
    }

    await touchCart(cartId, tx);
    return buildCartView(cartId, tx);
  });
}

export async function updateQuantity(
  identity: Identity,
  cartItemId: string,
  quantity: number,
): Promise<CartView> {
  assertValidQuantity(quantity);

  return prisma.$transaction(async (tx) => {
    const item = await findOwnedOpenCartItem(tx, identity, cartItemId);

    const variant = await getVariantById(item.variantId);
    if (variant.quantityAvailable < quantity) {
      throw new ConflictError(
        "Not enough stock available for this variant.",
      );
    }

    await tx.cartItem.update({
      where: { id: item.id },
      data: { quantity },
      select: { id: true },
    });
    await touchCart(item.cartId, tx);
    return buildCartView(item.cartId, tx);
  });
}

export async function removeItem(
  identity: Identity,
  cartItemId: string,
): Promise<CartView> {
  return prisma.$transaction(async (tx) => {
    const item = await findOwnedOpenCartItem(tx, identity, cartItemId);
    await tx.cartItem.delete({ where: { id: item.id } });
    await touchCart(item.cartId, tx);
    return buildCartView(item.cartId, tx);
  });
}

export async function clearCart(identity: Identity): Promise<CartView> {
  return prisma.$transaction(async (tx) => {
    const cart = await findOpenCart(tx, identity);
    if (!cart) {
      return emptyCartView();
    }
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    await touchCart(cart.id, tx);
    return buildCartView(cart.id, tx);
  });
}

const ABANDONED_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — plan §3.5 retention table.

/**
 * Deletes every cart (open or already-closed-by-merge) untouched for 30
 * days, and its items. Not wired to a schedule yet — the Cloud Scheduler
 * job itself is Phase 17/18; this function is what that job's handler
 * will call (plan §5 Phase 5, task 8).
 */
export async function pruneAbandonedCarts(
  now: Date = new Date(),
): Promise<{ cartsDeleted: number }> {
  const cutoff = new Date(now.getTime() - ABANDONED_CART_TTL_MS);

  return prisma.$transaction(async (tx) => {
    const abandoned = await tx.cart.findMany({
      where: { updatedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (abandoned.length === 0) {
      return { cartsDeleted: 0 };
    }

    const ids = abandoned.map((cart) => cart.id);
    // cart_items → carts is ON DELETE RESTRICT (same convention as every
    // other FK in this schema — see AGENTS.md), so items go first.
    await tx.cartItem.deleteMany({ where: { cartId: { in: ids } } });
    await tx.cart.deleteMany({ where: { id: { in: ids } } });
    return { cartsDeleted: ids.length };
  });
}
