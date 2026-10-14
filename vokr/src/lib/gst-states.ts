/**
 * The fixed enumeration of Indian states and union territories with their
 * two-digit GST state codes (CBIC Notification No. 12/2018 — Central
 * Tax), used to validate an address's `state` field and to decide the
 * CGST+SGST vs IGST split in `src/server/pricing/`. Public statutory data,
 * not a business decision — unlike the seller's own registered state
 * (decision D3, Vokr-Implementation-Plan.md §0.3), which this file does
 * not choose or default.
 *
 * Lives in `src/lib/` (no server-only dependencies) so the checkout
 * address form can build its state `<select>` from the same list the
 * server validates against — one source of truth, never two lists that
 * can drift.
 */
export const GST_STATES: ReadonlyArray<{ name: string; code: string }> = [
  { name: "Jammu and Kashmir", code: "01" },
  { name: "Himachal Pradesh", code: "02" },
  { name: "Punjab", code: "03" },
  { name: "Chandigarh", code: "04" },
  { name: "Uttarakhand", code: "05" },
  { name: "Haryana", code: "06" },
  { name: "Delhi", code: "07" },
  { name: "Rajasthan", code: "08" },
  { name: "Uttar Pradesh", code: "09" },
  { name: "Bihar", code: "10" },
  { name: "Sikkim", code: "11" },
  { name: "Arunachal Pradesh", code: "12" },
  { name: "Nagaland", code: "13" },
  { name: "Manipur", code: "14" },
  { name: "Mizoram", code: "15" },
  { name: "Tripura", code: "16" },
  { name: "Meghalaya", code: "17" },
  { name: "Assam", code: "18" },
  { name: "West Bengal", code: "19" },
  { name: "Jharkhand", code: "20" },
  { name: "Odisha", code: "21" },
  { name: "Chhattisgarh", code: "22" },
  { name: "Madhya Pradesh", code: "23" },
  { name: "Gujarat", code: "24" },
  { name: "Daman and Diu", code: "25" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "26" },
  { name: "Maharashtra", code: "27" },
  { name: "Andhra Pradesh (Old)", code: "28" },
  { name: "Karnataka", code: "29" },
  { name: "Goa", code: "30" },
  { name: "Lakshadweep", code: "31" },
  { name: "Kerala", code: "32" },
  { name: "Tamil Nadu", code: "33" },
  { name: "Puducherry", code: "34" },
  { name: "Andaman and Nicobar Islands", code: "35" },
  { name: "Telangana", code: "36" },
  { name: "Andhra Pradesh", code: "37" },
  { name: "Ladakh", code: "38" },
];

const GST_STATE_NAMES = new Set(GST_STATES.map((state) => state.name));
const GST_STATE_CODE_BY_NAME = new Map(
  GST_STATES.map((state) => [state.name, state.code]),
);

export function isValidGstState(name: string): boolean {
  return GST_STATE_NAMES.has(name);
}

/** Throws if `name` is not one of the fixed enumeration's names — callers must validate first. */
export function gstStateCode(name: string): string {
  const code = GST_STATE_CODE_BY_NAME.get(name);
  if (!code) {
    throw new Error(`gstStateCode: "${name}" is not a recognised GST state.`);
  }
  return code;
}
