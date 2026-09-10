import Link from "next/link";
import { createMetadata } from "@/lib/metadata";
import { SupportPageShell } from "@/components/marketing/support-page-shell";
import { HELP_CARDS } from "@/config/support-content";

export const metadata = createMetadata({
  title: "Help Center",
  alternates: { canonical: "/support-help" },
});

export default function SupportHelpPage() {
  return (
    <SupportPageShell
      title="Help Center"
      sub="Browse by topic, or reach out to a real person if you can't find what you need."
    >
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        {HELP_CARDS.map((card) => (
          <div key={card.title}>
            <h4 className="mb-1 text-base font-bold">{card.title}</h4>
            <p className="mb-2 text-sm text-muted">{card.body}</p>
            <Link
              href={card.href}
              className="text-sm font-semibold underline underline-offset-2"
            >
              {card.linkLabel} &rarr;
            </Link>
          </div>
        ))}
      </div>
    </SupportPageShell>
  );
}
