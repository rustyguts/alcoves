import { describe, it, expect } from "vitest";
import {
  IMAGE_VARIANTS,
  proxyQueryString,
  resolveVariant,
} from "~~/shared/image-variants";

describe("image-variants registry", () => {
  it("pins the canonical variant set (mirror of imageproxy.Variants in Go)", () => {
    // If this changes, change backend/internal/services/imageproxy/variants.go
    // in the same PR and bump its VariantsVersion.
    expect(IMAGE_VARIANTS).toEqual({
      search: { name: "search", maxWidth: 80, maxHeight: 80, quality: 70, format: "jpeg", cap: false },
      timeline: { name: "timeline", maxWidth: 384, maxHeight: 384, quality: 80, format: "webp", cap: false },
      face: { name: "face", maxWidth: 300, maxHeight: 300, quality: 80, format: "jpeg", cap: false },
      card: { name: "card", maxWidth: 720, maxHeight: 360, quality: 82, format: "jpeg", cap: true },
      preview: { name: "preview", maxWidth: 1920, maxHeight: 1080, quality: 90, format: "jpeg", cap: true },
    });
  });
});

describe("resolveVariant", () => {
  it("returns fixed dimensions for non-capped variants regardless of source size", () => {
    expect(resolveVariant("search")).toEqual({ width: 80, height: 80, quality: 70, format: "jpeg" });
    expect(resolveVariant("search", 40, 40)).toEqual({ width: 80, height: 80, quality: 70, format: "jpeg" });
    expect(resolveVariant("timeline", 10, 10)).toEqual({ width: 384, height: 384, quality: 80, format: "webp" });
    expect(resolveVariant("face")).toEqual({ width: 300, height: 300, quality: 80, format: "jpeg" });
  });

  it("clamps capped variants down to the source's own dimensions", () => {
    // Smaller-than-box source → request the source size (matches the cache key
    // the pre-warm job built from files.width/height).
    expect(resolveVariant("card", 500, 400)).toEqual({ width: 500, height: 360, quality: 82, format: "jpeg" });
    expect(resolveVariant("preview", 1000, 800)).toEqual({ width: 1000, height: 800, quality: 90, format: "jpeg" });
  });

  it("uses the full box for capped variants when the source is larger or unknown", () => {
    expect(resolveVariant("card", 5000, 4000)).toEqual({ width: 720, height: 360, quality: 82, format: "jpeg" });
    expect(resolveVariant("card")).toEqual({ width: 720, height: 360, quality: 82, format: "jpeg" });
    expect(resolveVariant("card", null, null)).toEqual({ width: 720, height: 360, quality: 82, format: "jpeg" });
    expect(resolveVariant("preview", 4000, 3000)).toEqual({ width: 1920, height: 1080, quality: 90, format: "jpeg" });
  });
});

describe("proxyQueryString", () => {
  it("emits alphabetically-sorted params", () => {
    expect(proxyQueryString({ width: 80, height: 80, quality: 70, format: "jpeg" })).toBe(
      "format=jpeg&height=80&quality=70&width=80",
    );
    expect(proxyQueryString({ width: 240, height: 240, quality: 70, format: "webp" })).toBe(
      "format=webp&height=240&quality=70&width=240",
    );
  });

  it("omits zero width/height (no constraint on that axis)", () => {
    expect(proxyQueryString({ width: 0, height: 0, quality: 80, format: "jpeg" })).toBe(
      "format=jpeg&quality=80",
    );
  });
});
