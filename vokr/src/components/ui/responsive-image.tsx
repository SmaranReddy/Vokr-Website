import { imageIdForLegacyUrl, responsiveSources, type ImageId } from "@/lib/images";

interface ResponsiveImageProps {
  /** The manifest image; defaults to the one made from `legacySrc`. A D7 slot names its photograph explicitly. */
  id?: ImageId;
  /** What renders while `NEXT_PUBLIC_ASSET_BASE_URL` is unset — today's `cdn.shopify.com` URL. */
  legacySrc: string;
  alt: string;
  /** The `sizes` attribute: how wide the slot is at each breakpoint, so phones never fetch desktop widths. */
  sizes: string;
  className?: string;
  /** Above-the-fold images load eagerly; everything else lazily. */
  priority?: boolean;
}

/**
 * A storefront photograph (plan §5 Phase 14, R21). Unconfigured, it is the
 * exact legacy `<img>`; configured, a `<picture>` with AVIF then WebP at
 * every pre-generated width. Not `next/image`: the files are already
 * encoded at build time, and the Cloud Run optimiser would spend CPU (and
 * egress) re-doing that work on every cache miss.
 */
export function ResponsiveImage({ id, legacySrc, alt, sizes, className, priority = false }: ResponsiveImageProps) {
  const sources = responsiveSources(id ?? imageIdForLegacyUrl(legacySrc), legacySrc);
  const loading = priority ? "eager" : "lazy";
  if (!sources.avif || !sources.webp) {
    // eslint-disable-next-line @next/next/no-img-element -- legacy CDN asset until NEXT_PUBLIC_ASSET_BASE_URL is set (Phase 14).
    return <img src={sources.src} alt={alt} className={className} />;
  }
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={sources.avif} sizes={sizes} />
      <source type="image/webp" srcSet={sources.webp} sizes={sizes} />
      <img
        src={sources.src}
        alt={alt}
        width={sources.width}
        height={sources.height}
        loading={loading}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        className={className}
      />
    </picture>
  );
}
