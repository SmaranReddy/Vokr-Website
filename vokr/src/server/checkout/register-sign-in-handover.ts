import { registerGuestUpgradeHandler } from "@/server/auth/upgrade";

import { handOverGuestCheckouts } from "./sign-in-handover";

/**
 * Side-effect-only module, imported by `src/server/auth/complete-sign-in.ts`
 * *before* the cart merge's registration, so handlers run in the order
 * session → cart (see `sign-in-handover.ts`).
 */
registerGuestUpgradeHandler(handOverGuestCheckouts);
