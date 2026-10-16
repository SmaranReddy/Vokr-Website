const DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** en-IN, Asia/Kolkata. Accepts ISO strings or Dates. */
export function formatAdminDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return DATE_FORMATTER.format(typeof value === "string" ? new Date(value) : value);
}

export const TABLE_CLASS = "w-full border-collapse text-left text-sm";
export const TH_CLASS = "border-b border-border px-2 py-1.5 font-medium text-muted";
export const TD_CLASS = "border-b border-border px-2 py-1.5 align-top text-foreground";
export const INPUT_CLASS = "rounded border border-border bg-background px-2 py-1 text-sm text-foreground";
export const BUTTON_CLASS =
  "rounded border border-border px-3 py-1 text-sm text-foreground hover:bg-foreground/5 disabled:opacity-50";
