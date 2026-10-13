/**
 * Programs the approved legacy site advertised but that do not exist
 * (§2A.6 row L1): no subscription system, referral ledger, discount
 * verification or ambassador pipeline is built or scoped. Each page keeps
 * its route, title and navigation entry, but renders only this name and
 * notice — none of the legacy offers ("Give ₹500. Get ₹500.", "15% off",
 * commissions) or calls to action. Asserted by unit and e2e tests.
 */
export interface UnavailableProgram {
  /** Page heading — the program's own name from the legacy page. */
  name: string;
  notice: string;
}

export const SUBSCRIPTION_PROGRAM: UnavailableProgram = {
  name: "Vokr Subscribe",
  notice:
    "Vokr Subscribe isn't available. It offers no subscriptions, discounts or other benefits at this time.",
};

export const REFERRAL_PROGRAM: UnavailableProgram = {
  name: "Refer a Friend",
  notice:
    "The referral program isn't available. It offers no discounts, credit or other benefits at this time.",
};

export const DISCOUNT_PROGRAM: UnavailableProgram = {
  name: "Discount Program",
  notice:
    "The discount program isn't available. It offers no discounts, codes or other benefits at this time.",
};

export const AMBASSADOR_PROGRAM: UnavailableProgram = {
  name: "Vokr Ambassadors",
  notice:
    "The Vokr Ambassador program isn't available. It offers no perks, commissions or other benefits at this time.",
};
