import {
  ORDERING_ENABLED,
  ORDERING_UNAVAILABLE_MESSAGE,
} from "@/config/commerce";
import { OrderingUnavailableError } from "@/lib/errors";

/**
 * Server-side half of the storefront-only launch gate (§2A.6 row L1).
 * The UI disables Add to Cart and quantity controls, but the cart API is
 * public, so every route that can put items into a cart or change how many
 * are in it calls this first — before a session is resolved, a cookie is
 * minted or the database is touched — whatever the variant's status or
 * stock. Removing items and clearing the cart stay allowed: they cannot
 * start a purchase, and a customer must be able to empty a bag that was
 * filled before the gate existed.
 */
export function assertOrderingEnabled(): void {
  if (!ORDERING_ENABLED) {
    throw new OrderingUnavailableError(ORDERING_UNAVAILABLE_MESSAGE);
  }
}
