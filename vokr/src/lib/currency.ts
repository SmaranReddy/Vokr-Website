const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const INR_PAISE_FORMATTER = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats paise as the legacy site's "₹9,995" style. An amount with paise
 * (the unrounded first-order discount, e.g. `69_990`) shows them: "₹699.90".
 */
export function formatPaiseAsRupees(pricePaise: number): string {
  if (pricePaise % 100 === 0) return `₹${INR_FORMATTER.format(pricePaise / 100)}`;
  return `₹${INR_PAISE_FORMATTER.format(pricePaise / 100)}`;
}
