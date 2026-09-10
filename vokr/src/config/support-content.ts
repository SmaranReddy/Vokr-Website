/**
 * Support copy shared between the homepage's condensed `.support-group`
 * accordion and the five standalone `support-*.html` pages, which carry
 * the same steps/FAQ/contact copy at full length. One source avoids the
 * exact duplication-then-drift Phase 4 exists to remove (task 2's
 * rationale extended to this content, not just CSS).
 */

export const ORDER_STATUS_STEPS = [
  {
    title: "Order confirmed",
    body: "You'll get an email as soon as we've received your order and payment has cleared.",
  },
  {
    title: "Preparing to ship",
    body: "Your pair is picked, quality-checked, and packed at our warehouse — usually within 24-48 hours.",
  },
  {
    title: "Shipped",
    body: "You'll receive tracking details by email and SMS the moment your order leaves our facility.",
  },
  {
    title: "Delivered",
    body: "Most orders arrive within 3-7 business days depending on your location in India.",
  },
];

export const EXCHANGE_RETURNS_INTRO =
  "Not the right fit? You have 30 days from delivery to exchange or return your Vokr shoes, free of charge, as long as they're unworn or gently tried on indoors.";

/**
 * The full standalone-page version (`support-exchange-returns.html`).
 * The homepage's condensed `.support-group` accordion shortens step 2 to
 * "Refunds are issued to your original payment method within 5-7
 * business days." — a genuine, smaller difference between the two
 * legacy pages, not a transcription error; `SiteHeader`'s `SupportGroup`
 * hardcodes that shorter sentence itself rather than importing this one.
 */
export const EXCHANGE_RETURNS_STEPS = [
  {
    title: "Start your request",
    body: 'Head to Order Status, pull up your order, and select "Exchange" or "Return" — no login required.',
  },
  {
    title: "Choose a new size or a refund",
    body: "Exchanges ship out as soon as we receive your original pair. Refunds for prepaid orders go back to your original payment method within 5-7 business days; refunds for Cash on Delivery (COD) orders are sent via bank transfer or Vokr store credit — your choice.",
  },
  {
    title: "Print your free label",
    body: "We'll email a prepaid return label. Drop the box at any courier partner pickup point near you.",
  },
  {
    title: "We'll take it from there",
    body: "Once your return is scanned by the courier, we'll send a confirmation and process your exchange or refund.",
  },
];

/**
 * The full standalone `support-faq.html` list (six items). The
 * homepage's condensed accordion shows only the first five — see
 * `HOMEPAGE_FAQ_ITEMS` below.
 */
export const FAQ_ITEMS = [
  {
    id: "faq-sizing",
    question: "What sizing system does Vokr use?",
    answer:
      "All Vokr shoes are sized in Indian/UK sizing (IN 4 to IN 11 for adults). Not sure of your size? Use our Find Your Fit quiz to get a recommendation in seconds.",
  },
  {
    id: "faq-shipping",
    question: "How long does shipping take?",
    answer:
      "Most orders across India arrive within 3-7 business days. Metro cities are usually on the faster end of that window.",
  },
  {
    id: "faq-exchange",
    question: "Can I exchange for a different size for free?",
    answer:
      "Yes. Exchanges within 30 days of delivery are free, including the return shipping label.",
  },
  {
    id: "faq-clean",
    question: "How do I clean my Vokr shoes?",
    answer:
      "A damp cloth handles most day-to-day marks. For a deeper clean, the knit upper and laces are machine-washable on a gentle cycle.",
  },
  {
    id: "faq-international",
    question: "Do you ship internationally?",
    answer:
      "Right now we ship across India only. We're working on international shipping — sign up to our newsletter to be the first to know.",
  },
  {
    id: "faq-subscription",
    question: "Do you offer a subscription plan?",
    answer:
      "Yes — Vokr Subscribe delivers a fresh pair every 3, 6, or 12 months at 15% off. You can pause or cancel anytime.",
  },
];

/** The homepage `.support-group` accordion shows only the first five (§2A.7 — verified against `index.html`). */
export const HOMEPAGE_FAQ_ITEMS = FAQ_ITEMS.slice(0, 5);

/** The homepage `.support-group` accordion's shorter step-2 copy (`index.html`, vs. the fuller standalone-page text above). */
export const HOMEPAGE_EXCHANGE_STEP_2 =
  "Exchanges ship out as soon as we receive your original pair. Refunds are issued to your original payment method within 5-7 business days.";

export const HELP_CARDS = [
  {
    title: "Sizing & Fit",
    body: "Find your Indian/UK size, understand fit preferences, and compare our styles.",
    linkLabel: "Take the fit quiz",
    href: "/#fit-quiz",
  },
  {
    title: "Orders & Shipping",
    body: "Track a package, understand delivery timelines, or update a shipping address.",
    linkLabel: "Check order status",
    href: "/support-order-status",
  },
  {
    title: "Returns & Exchanges",
    body: "Start a free return or exchange within 30 days of delivery.",
    linkLabel: "Start a return",
    href: "/support-exchange-returns",
  },
  {
    title: "Product Care",
    body: "Cleaning instructions, material info, and how to make your pair last.",
    linkLabel: "Read care tips",
    href: "/support-faq",
  },
];

export const CONTACT_DETAILS: {
  title: string;
  value: string;
  href?: string;
}[] = [
  { title: "Email", value: "support@vokr.shop", href: "mailto:support@vokr.shop" },
  { title: "Phone", value: "+91 80 0000 0000" },
  { title: "Hours", value: "Mon–Sat, 10am–7pm IST" },
  { title: "Chat", value: "Available on this page during business hours" },
];
