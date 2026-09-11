const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

/** Formats whole-rupee paise (e.g. `999_500`) as the legacy site's "₹9,995" style. */
export function formatPaiseAsRupees(pricePaise: number): string {
  return `₹${INR_FORMATTER.format(Math.round(pricePaise / 100))}`;
}
