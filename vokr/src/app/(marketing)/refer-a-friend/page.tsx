import { createMetadata } from "@/lib/metadata";
import { ReferralForm } from "./referral-form";

/**
 * `refer-a-friend.html` — Vokr-Implementation-Plan.md §2A's approved
 * source of truth. Section order, headings and body copy below are
 * transcribed verbatim from the legacy file's `cp-hero` / `cp-section`
 * markup (header/nav/cart/search/account/footer are global and skipped).
 * The "Get your referral link" form has no real referral/account backend
 * yet, so its submit is left inert rather than faked — see the
 * `aria-disabled`/`title` on the button below.
 */

export const metadata = createMetadata({
  title: "Refer a Friend",
  alternates: { canonical: "/refer-a-friend" },
});

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Get your link",
    body: "Enter your email below and we'll send you a unique referral link instantly.",
  },
  {
    step: "2",
    title: "Share it",
    body: "Send it to a friend who's been eyeing a new pair — text, DM, or however you'd normally recommend something.",
  },
  {
    step: "3",
    title: "You both get rewarded",
    body: "They save ₹500 on their first order. Once it ships, ₹500 in Vokr credit lands in your account.",
  },
];

export default function ReferAFriendPage() {
  return (
    <>
      {/* HERO */}
      <section className="px-5 py-16 text-center sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
            Refer a Friend
          </p>
          <h1 className="mb-4 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
            Give ₹500. Get ₹500. Simple as that.
          </h1>
          <p className="text-[15px] leading-relaxed text-muted">
            Share your unique link with a friend. They get ₹500 off their
            first pair, and you get ₹500 in Vokr credit once their order
            ships.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <ul className="space-y-6">
            {HOW_IT_WORKS.map((item) => (
              <li key={item.step} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                  {item.step}
                </div>
                <div>
                  <h4 className="mb-1 text-base font-bold">{item.title}</h4>
                  <p className="text-sm text-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* GET YOUR REFERRAL LINK */}
      <section className="border-t border-border px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-3xl font-bold tracking-tight sm:text-4xl">
            Get your referral link
          </h2>
          <ReferralForm />
          <p className="mt-3.5 text-xs text-muted-2">
            No limit on how many friends you refer — every successful
            referral earns you another ₹500.
          </p>
        </div>
      </section>
    </>
  );
}
