import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const LEGACY = "https://cdn.shopify.com/s/files/1/0231/2060/9358/files/M000_Black_PDP_Side.jpg?v=1778604540";

async function load(base: string | undefined) {
  vi.resetModules();
  vi.doMock("@/lib/env-client", () => ({ clientEnv: { NEXT_PUBLIC_ASSET_BASE_URL: base } }));
  return (await import("../responsive-image")).ResponsiveImage;
}

describe("<ResponsiveImage>", () => {
  it("unconfigured, renders exactly the legacy <img> (src, alt, class — nothing else)", async () => {
    const ResponsiveImage = await load(undefined);
    const { container } = render(<ResponsiveImage legacySrc={LEGACY} alt="Vokr Model 001 — Black" sizes="100vw" className="h-full w-full object-cover" />);
    expect(container.children).toHaveLength(1);
    const img = container.firstElementChild!;
    expect(img.tagName).toBe("IMG");
    expect(Object.fromEntries([...img.attributes].map((a) => [a.name, a.value]))).toEqual({
      src: LEGACY,
      alt: "Vokr Model 001 — Black",
      class: "h-full w-full object-cover",
    });
  });

  it("configured, renders <picture> with AVIF before WebP, sizes, dimensions and lazy loading", async () => {
    const ResponsiveImage = await load("/img");
    const { container } = render(<ResponsiveImage legacySrc={LEGACY} alt="Vokr Model 001 — Black" sizes="(min-width: 1024px) 33vw, 100vw" />);
    const sources = container.querySelectorAll("picture > source");
    expect([...sources].map((s) => s.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    expect(sources[0]?.getAttribute("srcset")).toMatch(/^\/img\/model-001-black-side-[0-9a-f]{10}-480\.avif 480w, /);
    expect(sources[0]?.getAttribute("sizes")).toBe("(min-width: 1024px) 33vw, 100vw");
    const img = container.querySelector("picture > img");
    expect(img?.getAttribute("alt")).toBe("Vokr Model 001 — Black");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("width")).toBe("2000");
    expect(container.innerHTML).not.toContain("cdn.shopify.com");
  });

  it("a D7 slot uses its named photograph; priority images load eagerly", async () => {
    const ResponsiveImage = await load("/img");
    const { container } = render(<ResponsiveImage id="outsole-detail" legacySrc={LEGACY} alt="Vokr outsole detail close-up" sizes="100vw" priority />);
    expect(container.querySelector("source")?.getAttribute("srcset")).toContain("/img/outsole-detail-");
    expect(container.querySelector("img")?.getAttribute("loading")).toBe("eager");
  });
});
