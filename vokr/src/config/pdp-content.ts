/**
 * The marketing copy block, hero image and feature list for each of the
 * five launch PDPs — transcribed verbatim from
 * `vokr-production/shop-*.html` (Phase 4 task 5). Kept alongside the
 * template rather than in the Phase 2 `Product.description` column: that
 * column is a short internal description, not this page's approved
 * marketing copy, and §2A.4 requires the copy block to be reproduced
 * unchanged. Price, sizes and stock come from the live catalog
 * (`@/server/catalog`) — the data this template is actually meant to be
 * "driven by".
 */

export interface PdpContent {
  heroImage: string;
  heroAlt: string;
  description: string;
  features: string[];
}

export const PDP_CONTENT: Record<string, PdpContent> = {
  "model-x": {
    heroImage:
      "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
    heroAlt: "Model x",
    description:
      "The original. One silhouette built for every surface — office floors, airport terminals, weekend errands. Cloud-like comfort, lightweight construction, and a copper-infused lining that keeps things fresh.",
    features: [
      "Copper-infused antimicrobial lining",
      "Lightweight foam midsole",
      "Stretch laces — tie once, slip on forever",
      "Natural rubber outsole",
      "Sized in Indian/UK sizing",
    ],
  },
  "model-001": {
    heroImage:
      "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
    heroAlt: "Model 001",
    description:
      "All-black. Every road. No ceremony. A slightly lower-profile take on our comfort formula, built for people who want one shoe that disappears into any outfit.",
    features: [
      "Copper-infused antimicrobial lining",
      "Lightweight foam midsole",
      "Stretch laces — tie once, slip on forever",
      "Natural rubber outsole",
      "Sized in Indian/UK sizing",
    ],
  },
  "kids-model-123": {
    heroImage:
      "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_White_PDP_Side.jpg?v=1778601772",
    heroAlt: "Kids Model 123",
    description:
      "Same materials, same comfort formula, built for smaller feet that are always on the move. Durable enough for the playground, easy enough for little hands to put on themselves.",
    features: [
      "Copper-infused antimicrobial lining",
      "Stretch laces — no tying required",
      "Extra-durable outsole for playground wear",
      "Sized in Indian/UK kids sizing",
    ],
  },
  socks: {
    heroImage:
      "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_White_PDP_Side.jpg?v=1778604639",
    heroAlt: "Vokr Socks",
    description:
      "Breathable, no-show socks designed to disappear inside your Vokr shoes. Moisture-wicking fabric keeps feet dry through long days.",
    features: [
      "Moisture-wicking breathable fabric",
      "No-show, low-cut design",
      "Reinforced heel and toe",
      "Pack of 3",
    ],
  },
  "stretch-laces": {
    heroImage:
      "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540",
    heroAlt: "Stretch Laces",
    description:
      "Replacement stretch laces using the same tie-once system found in every Vokr shoe. A simple swap to refresh an older pair.",
    features: [
      "Compatible with all Vokr shoe styles",
      "Elastic stretch — no retying needed",
      "Available in black or white",
    ],
  },
};
