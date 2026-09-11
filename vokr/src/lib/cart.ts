/**
 * Per-line cart quantity bounds (plan §3.5 `cart_items` row — enforced
 * again by a database CHECK in the Phase 5 migration). Lives in `src/lib/`
 * rather than `src/server/cart/`, mirroring the `env` / `env-client`
 * split: this file has zero server-only dependencies, so client
 * components (the quantity stepper in `src/components/cart/`) can import
 * it directly without pulling any part of `src/server/` into the browser
 * bundle.
 */
export const MIN_CART_ITEM_QUANTITY = 1;
export const MAX_CART_ITEM_QUANTITY = 10;
