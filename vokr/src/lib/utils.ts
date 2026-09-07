type ClassValue = string | number | null | undefined | false;

/** Joins conditional class names, skipping falsy values. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
