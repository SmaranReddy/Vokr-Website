import { createMetadata } from "@/lib/metadata";
import { SupportPageShell } from "@/components/marketing/support-page-shell";
import { ContactForm } from "@/components/marketing/contact-form";
import { CONTACT_DETAILS } from "@/config/support-content";

export const metadata = createMetadata({
  title: "Contact Us",
  alternates: { canonical: "/support-contact" },
});

export default function SupportContactPage() {
  return (
    <SupportPageShell
      title="Contact Us"
      sub="Our team typically replies within one business day."
    >
      <div className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {CONTACT_DETAILS.map((detail) => (
          <div key={detail.title}>
            <h4 className="mb-1 text-sm font-bold">{detail.title}</h4>
            <p className="text-sm text-muted">
              {detail.href ? (
                <a href={detail.href} className="underline underline-offset-2">
                  {detail.value}
                </a>
              ) : (
                detail.value
              )}
            </p>
          </div>
        ))}
      </div>
      <ContactForm />
    </SupportPageShell>
  );
}
