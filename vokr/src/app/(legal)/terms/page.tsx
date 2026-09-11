import Link from "next/link";
import { createMetadata } from "@/lib/metadata";
import { LegalPageShell } from "@/components/marketing/legal-page-shell";

export const metadata = createMetadata({
  title: "Terms & Conditions",
  alternates: { canonical: "/terms" },
});

/**
 * `terms.html`, transcribed verbatim (Vokr-Implementation-Plan.md §2A.4).
 * Clause 4 still reads "order confirmation email/SMS" — **R14** (Phase 4
 * task 7, §2A.6) proposes amending this to "email" only, since SMS is
 * deferred, but that change is legal copy pending manager approval and
 * is not applied here.
 */
export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms & Conditions"
      sub="Last updated January 2026. Please read these terms carefully before using vokr.shop or purchasing any Vokr product. Vokr.shop is operated by Vokr Inc., a company registered in India."
    >
      <p>
        <strong>1. Acceptance of Terms.</strong> By accessing vokr.shop,
        creating an account, or placing an order, you agree to be bound by
        these Terms &amp; Conditions and our Privacy Policy. If you do not
        agree, please do not use this site.
      </p>
      <p>
        <strong>2. Eligibility.</strong> You must be at least 18 years old,
        or using the site under the supervision of a parent or legal
        guardian, to place an order with Vokr. By ordering, you confirm the
        information you provide is accurate and that you&apos;re authorized
        to use the payment method selected.
      </p>
      <p>
        <strong>3. Products &amp; Pricing.</strong> All prices listed on
        vokr.shop are in Indian Rupees (₹) and are inclusive of GST unless
        stated otherwise. Product images are for illustration; actual colour
        may vary slightly due to screen settings and lighting. Vokr reserves
        the right to correct pricing or listing errors and to limit order
        quantities per customer.
      </p>
      <p>
        <strong>4. Order Confirmation.</strong> Placing an order is an offer
        to purchase. Your order is confirmed only once you receive an order
        confirmation email/SMS with your order ID. Vokr reserves the right
        to cancel any order due to stock unavailability, pricing errors, or
        suspected fraudulent activity, in which case a full refund will be
        issued.
      </p>
      <p>
        <strong>5. Payment Methods.</strong> We accept UPI, major
        debit/credit cards, net banking, and popular wallets through our
        secure payment partners. <strong>Cash on Delivery (COD)</strong> is
        available on eligible orders and PIN codes, subject to a nominal COD
        handling fee shown at checkout. Prepaid orders are prioritized for
        faster dispatch.
      </p>
      <p>
        <strong>6. Shipping &amp; Serviceability.</strong> We currently ship
        across India, subject to courier serviceability at your PIN code —
        you can check this at checkout. Delivery timelines shown (typically
        3–7 business days) are estimates and may be affected by courier
        delays, weather, regional restrictions, or circumstances beyond our
        control. Metro cities are usually serviced faster than remote or
        rural PIN codes.
      </p>
      <p>
        <strong>7. Returns, Exchanges &amp; RTO.</strong> Unworn or gently
        tried-on items may be returned or exchanged within 30 days of
        delivery, as described on our{" "}
        <Link href="/support-exchange-returns">Exchange/Returns page</Link>.
        Please ensure someone is available to receive your order and inspect
        it at the time of delivery — orders undelivered after repeated
        attempts may be returned to origin (RTO), and re-shipping charges
        may apply for a second dispatch.
      </p>
      <p>
        <strong>8. Refunds.</strong> Refunds for prepaid orders are credited
        to the original payment method within 5–7 business days of the
        returned item passing quality check. Refunds for COD orders are
        issued via bank transfer or Vokr store credit, as selected by you at
        the time of the return request.
      </p>
      <p>
        <strong>9. Product Use &amp; Warranty.</strong> Vokr products are
        designed for everyday casual and light athletic wear and are not
        intended as specialized medical, safety, or professional sports
        equipment. Manufacturing defects are covered for 6 months from the
        date of purchase; normal wear and tear, or damage from misuse, is
        not covered.
      </p>
      <p>
        <strong>10. Account Responsibility.</strong> If you create a Vokr
        account, you&apos;re responsible for maintaining the confidentiality
        of your login credentials and for all activity under your account.
      </p>
      <p>
        <strong>11. Intellectual Property.</strong> All content on vokr.shop
        — designs, logos, product photography, and written content — is the
        property of Vokr Inc. and may not be copied, reproduced, or used
        without prior written permission.
      </p>
      <p>
        <strong>12. Prohibited Use.</strong> You agree not to misuse this
        site, including attempting unauthorized access, placing fraudulent
        COD orders, or using the site for any unlawful purpose. Vokr
        reserves the right to blacklist accounts or numbers associated with
        repeated COD refusals or fraudulent activity.
      </p>
      <p>
        <strong>13. Limitation of Liability.</strong> To the maximum extent
        permitted under the Consumer Protection Act, 2019 and other
        applicable Indian law, Vokr Inc. is not liable for indirect,
        incidental, or consequential damages arising from the use of our
        products or this website.
      </p>
      <p>
        <strong>14. Governing Law &amp; Jurisdiction.</strong> These Terms
        are governed by the laws of India. Any disputes will be subject to
        the exclusive jurisdiction of the courts of Bengaluru, Karnataka.
      </p>
      <p>
        <strong>15. Grievance Redressal.</strong> In accordance with the
        Consumer Protection (E-Commerce) Rules, 2020, any complaints or
        concerns may be addressed to our Grievance Officer at{" "}
        <a href="mailto:grievance@vokr.shop">grievance@vokr.shop</a>. We aim
        to acknowledge complaints within 48 hours and resolve them within 30
        days.
      </p>
      <p>
        <strong>16. Changes to These Terms.</strong> We may update these
        Terms periodically to reflect changes in our practices or applicable
        law. Continued use of vokr.shop after changes are posted constitutes
        acceptance of the revised Terms.
      </p>
      <p>
        <strong>17. Contact.</strong> Questions about these Terms? Reach us
        at <a href="mailto:legal@vokr.shop">legal@vokr.shop</a> or through
        our <Link href="/support-contact">Contact page</Link>.
      </p>
    </LegalPageShell>
  );
}
