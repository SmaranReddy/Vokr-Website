import Link from "next/link";
import { createMetadata } from "@/lib/metadata";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";

export const metadata = createMetadata({
  title: "Privacy Policy",
  alternates: { canonical: "/privacy-policy" },
});

/** `privacy-policy.html`, transcribed verbatim (Vokr-Implementation-Plan.md §2A.4). */
export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      sub="Last updated January 2026. This policy explains what information Vokr collects, how we use it, and the choices you have. It's drafted in line with applicable Indian data protection law, including the Digital Personal Data Protection Act, 2023."
    >
      <p>
        <strong>1. Information We Collect.</strong> When you shop with us,
        create an account, sign up for updates, or contact support, we may
        collect:
      </p>
      <p>
        — Contact details: name, email address, mobile number, shipping and
        billing address, PIN code
        <br />
        — Order information: items purchased, order history, size and fit
        preferences, COD vs. prepaid preference
        <br />
        — Payment information: processed securely by our payment partners
        (UPI, cards, net banking); we do not store full card numbers
        <br />
        — Usage data: pages visited, device and browser type, and how you
        interact with vokr.shop
      </p>
      <p>
        <strong>2. How We Use Your Information.</strong> We use the
        information we collect to:
      </p>
      <p>
        — Process and fulfill your orders, including COD verification,
        shipping, and returns
        <br />
        — Check courier serviceability at your PIN code and provide accurate
        delivery estimates
        <br />
        — Provide customer support and respond to your inquiries
        <br />
        — Personalize your experience, including size recommendations from
        our Find Your Fit quiz
        <br />
        — Send you order updates via email/SMS and, with your consent,
        marketing communications
        <br />
        — Improve our products, website, and services over time
      </p>
      <p>
        <strong>3. Cookies &amp; Tracking.</strong> We use cookies and
        similar technologies to keep your cart and sign-in session active,
        remember your preferences, and understand how visitors use our
        site. You can control cookies through your browser settings.
      </p>
      <p>
        <strong>4. How We Share Information.</strong> We do not sell your
        personal information. We share data only with trusted service
        providers who help us operate — such as courier and logistics
        partners (for delivery and RTO handling), payment processors, and
        customer support tools — and only to the extent necessary for them
        to perform their services, under confidentiality obligations.
      </p>
      <p>
        <strong>5. Data Storage &amp; Security.</strong> Your data is stored
        on secure servers, and we use industry-standard technical and
        organizational measures to protect it against unauthorized access,
        loss, or misuse. No method of transmission over the internet is
        100% secure, but we work to protect your data at every step.
      </p>
      <p>
        <strong>6. Data Retention.</strong> We retain your personal
        information for as long as necessary to fulfill the purposes
        described in this policy, comply with our legal and tax obligations
        under Indian law, resolve disputes, and enforce our agreements.
      </p>
      <p>
        <strong>7. Your Rights &amp; Choices.</strong> You can:
      </p>
      <p>
        — Unsubscribe from marketing emails or SMS at any time using the
        link/instructions provided
        <br />
        — Request access to, correction of, or deletion of your personal
        data
        <br />
        — Withdraw previously given consent for data processing, subject to
        our legal obligations (e.g. order and tax records)
        <br />
        — Ask us how your data is being used, by contacting us directly
      </p>
      <p>
        <strong>8. Children&apos;s Privacy.</strong> vokr.shop is not
        directed at children under 13, and we do not knowingly collect
        personal information from children under 13 without parental
        consent.
      </p>
      <p>
        <strong>9. Grievance Officer.</strong> In accordance with applicable
        Indian law, our designated Grievance Officer can be reached at{" "}
        <a href="mailto:grievance@vokr.shop">grievance@vokr.shop</a> for any
        privacy-related complaints, which we aim to resolve within 30 days.
      </p>
      <p>
        <strong>10. Changes to This Policy.</strong> We may update this
        Privacy Policy periodically. We&apos;ll post the updated version
        here with a revised &quot;last updated&quot; date, and for
        significant changes, we may notify you directly.
      </p>
      <p>
        <strong>11. Contact Us.</strong> Privacy questions or data requests
        can be sent to{" "}
        <a href="mailto:privacy@vokr.shop">privacy@vokr.shop</a> or through
        our <Link href="/support-contact">Contact page</Link>.
      </p>
    </LegalPageShell>
  );
}
