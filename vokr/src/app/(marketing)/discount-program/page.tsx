import { createMetadata } from "@/lib/metadata";
import { ProgramUnavailablePage } from "@/components/marketing/program-unavailable-page";
import { DISCOUNT_PROGRAM } from "@/config/programs";

/**
 * `discount-program.html` advertised a program that does not exist. Under §2A.6 row
 * L1 its offers, figures, form and calls to action are removed; the
 * route, title and navigation entry stay so existing links still resolve
 * to an honest answer. See `src/config/programs.ts`.
 */

export const metadata = createMetadata({
  title: "Discount Program",
  alternates: { canonical: "/discount-program" },
});

export default function DiscountProgramPage() {
  return <ProgramUnavailablePage program={DISCOUNT_PROGRAM} />;
}
