/**
 * Marks a program page whose offer does not exist yet (§2A.6 row L1).
 * The subscription, referral, discount and ambassador pages describe
 * offers — percentage discounts, ₹500 credits, commissions — with no
 * system behind them. Rather than remove approved pages and navigation,
 * each one opens with this notice so no customer reads the page as a
 * live offer. Remove the notice only when the program actually exists.
 */
export function ProgramUnavailableNotice({ children }: { children: string }) {
  return (
    <div className="border-b border-border-strong bg-surface-2 px-5 py-4">
      <p
        role="note"
        className="mx-auto max-w-2xl text-center text-sm font-medium text-foreground"
      >
        {children}
      </p>
    </div>
  );
}
