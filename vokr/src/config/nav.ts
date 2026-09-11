/**
 * Navigation link data, extracted verbatim (labels, order, targets) from
 * the legacy site's header hamburger menu and footer link columns
 * (`vokr-production.zip:vokr-production/index.html`). Shared by
 * `SiteHeader`, `SiteFooter` and `app/sitemap.ts` so the three never
 * drift apart — Vokr-Implementation-Plan.md §2A.4 requires navigation
 * structure to be reproduced unchanged; D1 (§2A.6) is the one approved
 * exception, so `gift-cards.html` is omitted everywhere rather than
 * filtered ad hoc per call site.
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface NavGroup {
  title: string;
  links: NavLink[];
}

/** Hamburger menu panel — three groups, in legacy order. */
export const HEADER_NAV_GROUPS: NavGroup[] = [
  {
    title: "Shop",
    links: [
      { label: "Model x", href: "/shop/model-x" },
      { label: "Model 001", href: "/shop/model-001" },
      { label: "Kids Model 123", href: "/shop/kids-model-123" },
      { label: "Socks", href: "/shop/socks" },
      { label: "Laces", href: "/shop/stretch-laces" },
      // gift-cards.html intentionally omitted — D1, §2A.6.
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Vokr", href: "/about-vokr" },
      { label: "Why Vokr", href: "/why-vokr" },
      { label: "Blog", href: "/blog" },
      { label: "Vokr Ambassadors", href: "/vokr-ambassadors" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Order Status", href: "/support-order-status" },
      { label: "Exchange/Returns", href: "/support-exchange-returns" },
      { label: "FAQ", href: "/support-faq" },
      { label: "Help", href: "/support-help" },
      { label: "Contact Us", href: "/support-contact" },
    ],
  },
];

/** Footer columns — legacy order: Products, Support, Everything Else. */
export const FOOTER_LINK_GROUPS: NavGroup[] = [
  {
    title: "Products",
    links: [
      { label: "Model x", href: "/shop/model-x" },
      { label: "Model 001", href: "/shop/model-001" },
      { label: "Kids Model abc", href: "/shop/kids-model-123" },
      { label: "Socks", href: "/shop/socks" },
      { label: "Laces", href: "/shop/stretch-laces" },
      // gift-cards.html intentionally omitted — D1, §2A.6.
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Center", href: "/support-help" },
      { label: "FAQs", href: "/support-faq" },
      { label: "Subscription", href: "/subscription" },
      { label: "Order Status", href: "/support-order-status" },
      { label: "Returns & Exchanges", href: "/support-exchange-returns" },
      { label: "Contact Us", href: "/support-contact" },
    ],
  },
  {
    title: "Everything Else",
    links: [
      { label: "Jobs", href: "/jobs" },
      { label: "Technology", href: "/technology" },
      { label: "Community", href: "/community" },
      { label: "Why Vokr", href: "/why-vokr" },
      { label: "About Vokr", href: "/about-vokr" },
      { label: "Refer a Friend", href: "/refer-a-friend" },
      { label: "Discount Program", href: "/discount-program" },
      { label: "Wholesale Orders", href: "/wholesale-orders" },
      { label: "Blog", href: "/blog" },
      { label: "Vokr Ambassadors", href: "/vokr-ambassadors" },
      { label: "Analyze your shoes", href: "/analyze-your-shoes" },
    ],
  },
];

/** Every route this migration ships, for `app/sitemap.ts` (task 11). */
export const MARKETING_ROUTES = [
  "/",
  "/about-vokr",
  "/analyze-your-shoes",
  "/blog",
  "/community",
  "/discount-program",
  "/jobs",
  "/privacy-policy",
  "/refer-a-friend",
  "/reviews",
  "/subscription",
  "/support-contact",
  "/support-exchange-returns",
  "/support-faq",
  "/support-help",
  "/support-order-status",
  "/technology",
  "/terms",
  "/vokr-ambassadors",
  "/wholesale-orders",
  "/why-vokr",
] as const;

export const SHOP_SLUGS = [
  "model-x",
  "model-001",
  "kids-model-123",
  "socks",
  "stretch-laces",
] as const;
