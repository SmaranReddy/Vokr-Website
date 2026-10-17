import { ConflictError } from "@/lib/errors";
import { gstStateCode, isValidGstState } from "@/lib/gst-states";

/**
 * Pure invoice rules (plan §5 Phase 9, task 8; R11). Every legal-format
 * choice here is this codebase's reading of the CGST Act and CGST Rules
 * r.46 and is **pending review by the owner's CA** (R11's acceptance
 * criterion: "invoice reviewed by the CA").
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Indian financial year (April–March) of an instant, in Asia/Kolkata: `2026-27`. */
export function financialYearOf(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1; // April = month 3
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * `VK/2627/000001`: 14 characters — r.46(b) allows at most 16, consecutive
 * and unique for the financial year, with `/` and `-` permitted.
 */
export function invoiceNumberFor(financialYear: string, serial: number): string {
  return documentNumber("VK", financialYear, serial);
}

/** `VKC/2627/000001`: 15 characters — credit notes are their own consecutive series (r.53, pending CA review). */
export function creditNoteNumberFor(financialYear: string, serial: number): string {
  return documentNumber("VKC", financialYear, serial);
}

function documentNumber(prefix: string, financialYear: string, serial: number): string {
  const match = /^(\d{2})(\d{2})-(\d{2})$/.exec(financialYear);
  if (!match || !Number.isInteger(serial) || serial < 1 || serial > 999_999) {
    throw new Error(`cannot number ${prefix} document ${serial} in ${financialYear}`);
  }
  return `${prefix}/${match[2]}${match[3]}/${String(serial).padStart(6, "0")}`;
}

/**
 * GSTIN shape: 2-digit state code + PAN (5 letters, 4 digits, 1 letter) +
 * entity number + `Z` + check character. The check character itself is
 * not verified here — a checksum written from memory and wrong would
 * refuse the real GSTIN and stop every shipment; the CA review covers it.
 */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface InvoiceSeller {
  legalName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
}

/** 409 — the order cannot be invoiced yet (missing decision or a snapshot that does not reconcile). Shipping waits. */
export class InvoiceBlockedError extends ConflictError {}

/** Seller details from configuration (decision D3). Throws {@link InvoiceBlockedError} rather than inventing any of them. */
export function parseInvoiceSeller(env: {
  INVOICE_SELLER_LEGAL_NAME?: string;
  INVOICE_SELLER_GSTIN?: string;
  INVOICE_SELLER_ADDRESS?: string;
  CHECKOUT_SELLER_STATE?: string;
}): InvoiceSeller {
  const legalName = env.INVOICE_SELLER_LEGAL_NAME?.trim();
  const gstin = env.INVOICE_SELLER_GSTIN?.trim().toUpperCase();
  const address = env.INVOICE_SELLER_ADDRESS?.trim();
  const state = env.CHECKOUT_SELLER_STATE?.trim();
  const missing = [
    !legalName && "INVOICE_SELLER_LEGAL_NAME",
    !gstin && "INVOICE_SELLER_GSTIN",
    !address && "INVOICE_SELLER_ADDRESS",
    !state && "CHECKOUT_SELLER_STATE",
  ].filter(Boolean);
  if (missing.length > 0 || !legalName || !gstin || !address || !state) {
    throw new InvoiceBlockedError(
      `Tax invoices need the seller's legal details (decision D3): ${missing.join(", ")} not set. The order cannot ship until they are.`,
    );
  }
  if (!isValidGstState(state)) throw new InvoiceBlockedError(`CHECKOUT_SELLER_STATE "${state}" is not a GST state.`);
  if (!GSTIN_PATTERN.test(gstin)) throw new InvoiceBlockedError("INVOICE_SELLER_GSTIN is not a well-formed GSTIN.");
  const stateCode = gstStateCode(state);
  if (gstin.slice(0, 2) !== stateCode) {
    throw new InvoiceBlockedError(
      `INVOICE_SELLER_GSTIN's state code ${gstin.slice(0, 2)} does not match CHECKOUT_SELLER_STATE (${state}, ${stateCode}).`,
    );
  }
  return { legalName, gstin, address, state, stateCode };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const tens = TENS[Math.floor(n / 10)] ?? "";
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole rupees in the Indian system (thousand, lakh, crore). */
export function rupeesInWords(rupees: number): string {
  if (!Number.isInteger(rupees) || rupees < 0) throw new Error(`not a rupee amount: ${rupees}`);
  if (rupees === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${rupeesInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** `Rupees Nine Thousand Nine Hundred Ninety-Five and Fifty Paise Only`. */
export function amountInWords(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new Error(`not a paise amount: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${rupeesInWords(rupees)}${rest ? ` and ${belowHundred(rest)} Paise` : ""} Only`;
}
