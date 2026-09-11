import { createMetadata } from "@/lib/metadata";
import { SupportPageShell } from "@/components/marketing/support-page-shell";
import {
  EXCHANGE_RETURNS_INTRO,
  EXCHANGE_RETURNS_STEPS,
} from "@/config/support-content";

export const metadata = createMetadata({
  title: "Exchange / Returns",
  alternates: { canonical: "/support-exchange-returns" },
});

export default function SupportExchangeReturnsPage() {
  return (
    <SupportPageShell title="Exchange / Returns" sub={EXCHANGE_RETURNS_INTRO}>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {EXCHANGE_RETURNS_STEPS.map((step) => (
          <div key={step.title}>
            <h4 className="mb-1 text-sm font-bold">{step.title}</h4>
            <p className="text-sm text-muted">{step.body}</p>
          </div>
        ))}
      </div>
    </SupportPageShell>
  );
}
