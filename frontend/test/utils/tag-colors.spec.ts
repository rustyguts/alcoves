import { TAG_COLOR_PALETTE, isTagColorInPalette } from "~~/shared/tag-colors";

describe("tag-colors", () => {
  describe("TAG_COLOR_PALETTE", () => {
    it("contains 12 predefined colors", () => {
      expect(TAG_COLOR_PALETTE).toHaveLength(12);
    });

    it("all entries are valid uppercase hex colors", () => {
      for (const color of TAG_COLOR_PALETTE) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/);
      }
    });

    it("has no duplicates", () => {
      const unique = new Set(TAG_COLOR_PALETTE);
      expect(unique.size).toBe(TAG_COLOR_PALETTE.length);
    });
  });

  describe("isTagColorInPalette", () => {
    it("returns true for palette colors (case-insensitive)", () => {
      expect(isTagColorInPalette("#E11D48")).toBe(true);
      expect(isTagColorInPalette("#e11d48")).toBe(true);
      expect(isTagColorInPalette(" #3B82F6 ")).toBe(true);
    });

    it("returns false for colors not in palette", () => {
      expect(isTagColorInPalette("#000000")).toBe(false);
      expect(isTagColorInPalette("#FFFFFF")).toBe(false);
      expect(isTagColorInPalette("not-a-color")).toBe(false);
    });
  });
});
