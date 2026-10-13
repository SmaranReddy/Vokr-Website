import { createMetadata } from "@/lib/metadata";
import { ProgramUnavailablePage } from "@/components/marketing/program-unavailable-page";
import { REFERRAL_PROGRAM } from "@/config/programs";

/**
 * `refer-a-friend.html` advertised a program that does not exist. Under §2A.6 row
 * L1 its offers, figures, form and calls to action are removed; the
 * route, title and navigation entry stay so existing links still resolve
 * to an honest answer. See `src/config/programs.ts`.
 */

export const metadata = createMetadata({
  title: "Refer a Friend",
  alternates: { canonical: "/refer-a-friend" },
});

export default function ReferAFriendPage() {
  return <ProgramUnavailablePage program={REFERRAL_PROGRAM} />;
}
