import { createMetadata } from "@/lib/metadata";
import { SupportPageShell } from "@/components/marketing/support-page-shell";
import { Accordion, type AccordionItemData } from "@/components/marketing/accordion";
import { FAQ_ITEMS } from "@/config/support-content";

export const metadata = createMetadata({
  title: "FAQ",
  alternates: { canonical: "/support-faq" },
});

const ITEMS: AccordionItemData[] = FAQ_ITEMS.map((item) => ({
  id: item.id,
  label: item.question,
  content: item.answer,
}));

export default function SupportFaqPage() {
  return (
    <SupportPageShell
      title="Frequently Asked Questions"
      sub="Quick answers to the things people ask us most."
    >
      <Accordion items={ITEMS} defaultOpenId={ITEMS[0]?.id} variant="faq" />
    </SupportPageShell>
  );
}
