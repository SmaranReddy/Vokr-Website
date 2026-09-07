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
