import { describe, expect, it } from "vitest";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/config/site";

describe("createMetadata", () => {
  it("defaults to the site name, description and metadataBase", () => {
    const metadata = createMetadata();
    expect(metadata.title).toBe(siteConfig.name);
    expect(metadata.description).toBe(siteConfig.description);
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.metadataBase?.toString()).toBe(`${siteConfig.url}/`);
  });

  it("lets overrides win over the defaults", () => {
    const metadata = createMetadata({ title: "Custom title" });
    expect(metadata.title).toBe("Custom title");
    expect(metadata.description).toBe(siteConfig.description);
  });
});

describe("siteConfig.description", () => {
  // It is the meta description of every page without its own, so it is
  // what search results show (§2A.6 row L1).
  it("is customer-facing copy, not internal project wording", () => {
    expect(siteConfig.description).not.toMatch(
      /application|foundation|rebuil|D2C|production|storefront/i,
    );
  });

  it("makes no rating, customer-count, discount or availability claim", () => {
    expect(siteConfig.description).not.toMatch(
      /\d+(\.\d+)?\s*(\/\s*5|stars?|★)|\d[\d,]*\+|review|rated|customers|% off|discount|available now|in stock|free shipping/i,
    );
  });
});
