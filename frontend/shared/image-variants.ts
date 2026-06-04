// Single source of truth for every image-proxy transform the app requests.
//
// This is the MIRROR of the backend registry in
// backend/internal/services/imageproxy/variants.go — the two MUST be kept in
// lockstep. The backend's hourly pre-warm job generates exactly these variants
// for every image, so each cache key the frontend requests here is a warm-cache
// hit. A drift means wasted pre-warm work (keys the UI never asks for) or missed
// warming (keys the UI asks for but the job never generated). When you change a
// variant, change variants.go in the same PR (and bump its VariantsVersion).

export type ImageFormat = "jpeg" | "webp" | "avif" | "png";

export interface ImageVariant {
  /** Stable identifier shared with the Go registry. */
  name: string;
  /** Output box; aspect ratio is preserved and the source is only downscaled. */
  maxWidth: number;
  maxHeight: number;
  /** Encoder quality 1-100. */
  quality: number;
  format: ImageFormat;
  /**
   * When true, the requested dimensions are clamped DOWN to the source's own
   * pixel size (a 500px-wide original is requested at w500, not w720) — matching
   * Variant.Cap in the backend so the cache keys are identical. When false the
   * variant always requests the fixed maxWidth×maxHeight box.
   */
  cap: boolean;
}

/**
 * The canonical variant set. Mirror of imageproxy.Variants (Go).
 *
 *  search   80×80     q70 jpeg  fixed  — search-result avatars
 *  timeline 240×240   q70 webp  fixed  — timeline grid
 *  face     300×300   q80 jpeg  fixed  — people / face grid
 *  card     720×360   q82 jpeg  capped — library browser cards
 *  preview  1920×1080 q90 jpeg  capped — full-screen lightbox
 */
export const IMAGE_VARIANTS = {
  search: { name: "search", maxWidth: 80, maxHeight: 80, quality: 70, format: "jpeg", cap: false },
  timeline: { name: "timeline", maxWidth: 240, maxHeight: 240, quality: 70, format: "webp", cap: false },
  face: { name: "face", maxWidth: 300, maxHeight: 300, quality: 80, format: "jpeg", cap: false },
  card: { name: "card", maxWidth: 720, maxHeight: 360, quality: 82, format: "jpeg", cap: true },
  preview: { name: "preview", maxWidth: 1920, maxHeight: 1080, quality: 90, format: "jpeg", cap: true },
} as const satisfies Record<string, ImageVariant>;

export type ImageVariantName = keyof typeof IMAGE_VARIANTS;

export interface ResolvedTransform {
  width: number;
  height: number;
  quality: number;
  format: ImageFormat;
}

/**
 * Resolve a named variant against a source image's pixel dimensions (pass
 * undefined/null when unknown). The result mirrors Variant.Resolve in Go, so the
 * resulting cache key matches exactly what the pre-warm job generated.
 */
export function resolveVariant(
  name: ImageVariantName,
  sourceWidth?: number | null,
  sourceHeight?: number | null,
): ResolvedTransform {
  const v = IMAGE_VARIANTS[name];
  let width: number = v.maxWidth;
  let height: number = v.maxHeight;
  if (v.cap) {
    if (sourceWidth && sourceWidth > 0 && sourceWidth < width) width = sourceWidth;
    if (sourceHeight && sourceHeight > 0 && sourceHeight < height) height = sourceHeight;
  }
  return { width, height, quality: v.quality, format: v.format };
}

/**
 * Build the deterministic, alphabetically-sorted image-proxy query string for a
 * resolved transform. Sharing one builder across every call site guarantees a
 * single URL shape (and so a single browser/CDN cache entry) per variant+file.
 * Zero width/height are omitted (no constraint on that axis), matching the
 * server's optional query params.
 */
export function proxyQueryString(t: ResolvedTransform): string {
  const params: [string, string][] = [["format", t.format]];
  if (t.width) params.push(["width", String(t.width)]);
  if (t.height) params.push(["height", String(t.height)]);
  if (t.quality) params.push(["quality", String(t.quality)]);
  params.sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(params).toString();
}
