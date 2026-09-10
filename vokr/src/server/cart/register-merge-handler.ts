import { registerGuestUpgradeHandler } from "@/server/auth/upgrade";

import { mergeGuestCartIntoUserCart } from "./merge";

/**
 * Side-effect-only module: imported once for its registration, not for
 * any export. `src/server/auth/complete-sign-in.ts` imports this so the
 * handler is registered before `runGuestUpgradeHandlers()` can possibly
 * run, regardless of which route (`signin`, `callback` or `confirm`)
 * triggers the sign-in — see `src/server/auth/upgrade.ts` (plan §5 Phase
 * 5, task 5).
 */
registerGuestUpgradeHandler(mergeGuestCartIntoUserCart);
