/**
 * The personal-data inventory (plan §5 Phase 17, task 9; DPDP), as code:
 * every database column that holds personal data, why it is held, how
 * long, and whether the data-subject export includes it.
 * `__tests__/inventory.test.ts` reads `prisma/schema.prisma` and fails when
 * a personal-data column is added without an entry here — so a new field
 * cannot silently escape the export or this record.
 * The human-readable version is `docs/privacy/data-inventory.md`.
 */

export interface PersonalDataField {
  /** `Model.field` as in `prisma/schema.prisma`. */
  field: string;
  what: string;
  why: string;
  retention: string;
  /** `true`, or why the export leaves it out. */
  exported: true | string;
}

export const PERSONAL_DATA_INVENTORY: readonly PersonalDataField[] = [
  { field: "AppUser.email", what: "Account email", why: "Sign-in, order updates", retention: "Life of the account", exported: true },
  { field: "AppUser.displayName", what: "Display name", why: "Greeting in the account", retention: "Life of the account", exported: true },
  { field: "AppUser.phoneEnc", what: "Phone (encrypted)", why: "Delivery contact", retention: "Life of the account", exported: true },
  { field: "Address.nameEnc", what: "Recipient name (encrypted)", why: "Delivery", retention: "Life of the account", exported: true },
  { field: "Address.line1Enc", what: "Address line 1 (encrypted)", why: "Delivery", retention: "Life of the account", exported: true },
  { field: "Address.line2Enc", what: "Address line 2 (encrypted)", why: "Delivery", retention: "Life of the account", exported: true },
  { field: "Address.phoneEnc", what: "Recipient phone (encrypted)", why: "Courier contact", retention: "Life of the account", exported: true },
  { field: "Address.city", what: "City", why: "Delivery, serviceability", retention: "Life of the account", exported: true },
  { field: "Address.state", what: "State", why: "Delivery, GST place of supply", retention: "Life of the account", exported: true },
  { field: "Address.pincode", what: "PIN code", why: "Delivery, serviceability", retention: "Life of the account", exported: true },
  { field: "CheckoutSession.contactEmailEnc", what: "Checkout email (encrypted)", why: "Order updates, guest lookup", retention: "With the checkout session", exported: true },
  { field: "Order.contactEmailEnc", what: "Order email (encrypted)", why: "Order updates, guest lookup", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipNameEnc", what: "Ship-to name (encrypted)", why: "Delivery, tax invoice", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipPhoneEnc", what: "Ship-to phone (encrypted)", why: "Courier contact", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipLine1Enc", what: "Ship-to line 1 (encrypted)", why: "Delivery, tax invoice", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipLine2Enc", what: "Ship-to line 2 (encrypted)", why: "Delivery, tax invoice", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipCity", what: "Ship-to city", why: "Delivery, tax invoice", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipState", what: "Ship-to state", why: "GST place of supply", retention: "8 years (tax records)", exported: true },
  { field: "Order.shipPincode", what: "Ship-to PIN code", why: "Delivery", retention: "8 years (tax records)", exported: true },
  {
    field: "EmailLog.recipientHash",
    what: "SHA-256 of the address an email was sent to",
    why: "Proof of one send per event without storing the address",
    retention: "180 days after sending",
    exported: "A one-way hash of an address the export already contains; the send records themselves are exported",
  },
  {
    field: "GuestSession.tokenHash",
    what: "SHA-256 of a guest browser's session token",
    why: "Recognising a guest's bag",
    retention: "Until the guest session expires",
    exported: "A credential hash about a device, not information about the person; exporting it would weaken the session",
  },
  {
    field: "RateLimitCounter.key",
    what: "Rate-limit bucket names: a scope (e.g. auth:signin:email) plus an unsalted SHA-256 digest of the IP, email or id — pseudonymised, not anonymised (a known email or IPv4 can be checked against it)",
    why: "Abuse protection (sign-in, reset, lookups)",
    retention: "24 hours (pruned by the maintenance job)",
    exported: "Transient security data, deleted within 24 hours",
  },
  {
    field: "ConsentRecord.subjectHash",
    what: "SHA-256 of the email a consent was given for — pseudonymised, not anonymised",
    why: "Proof of consent per purpose (DPDP), including newsletter subscribers without an account",
    retention: "Life of the account + 1 year (plan §3.5); kept through erasure as proof (legal review)",
    exported: "A one-way hash of the account email; the consent records themselves are exported",
  },
  {
    field: "ConsentRecord.ipHash",
    what: "SHA-256 of the IP a consent was given from",
    why: "Evidence of where consent was given",
    retention: "With the consent record",
    exported: "A one-way hash of a network address, not information the customer gave",
  },
];

/** Column names that mark personal data; the inventory test checks every match in the schema is listed above. */
export const PERSONAL_DATA_FIELD_PATTERN = /^(?:[a-z0-9]+Enc|[a-z0-9]*Hash|email|phone|displayName|ship(?:City|State|Pincode)|key)$/i;
/** Models whose plain location columns are personal data too. */
export const LOCATION_MODELS = new Set(["Address"]);
