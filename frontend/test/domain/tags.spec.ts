import {
  normalizeTagName,
  normalizeHexColor,
  isUniqueViolation,
} from "~~/server/domain/library/tags";

describe("tag domain utils", () => {
  describe("normalizeTagName", () => {
    it("trims leading and trailing whitespace", () => {
      expect(normalizeTagName("  hello  ")).toBe("hello");
    });

    it("collapses multiple internal spaces to one", () => {
      expect(normalizeTagName("hello   world")).toBe("hello world");
    });

    it("handles mixed whitespace", () => {
      expect(normalizeTagName("  foo   bar   baz  ")).toBe("foo bar baz");
    });

    it("returns empty string for whitespace-only input", () => {
      expect(normalizeTagName("   ")).toBe("");
    });
  });

  describe("normalizeHexColor", () => {
    it("accepts and uppercases valid palette colors", () => {
      expect(normalizeHexColor("#e11d48")).toBe("#E11D48");
      expect(normalizeHexColor(" #3b82f6 ")).toBe("#3B82F6");
    });

    it("throws for invalid hex format", () => {
      expect(() => normalizeHexColor("red")).toThrow("Color must be a 6-digit hex value");
      expect(() => normalizeHexColor("#FFF")).toThrow("Color must be a 6-digit hex value");
      expect(() => normalizeHexColor("#GGGGGG")).toThrow("Color must be a 6-digit hex value");
    });

    it("throws for valid hex but not in palette", () => {
      expect(() => normalizeHexColor("#000000")).toThrow(
        "Color must be one of the predefined tag colors",
      );
      expect(() => normalizeHexColor("#FFFFFF")).toThrow(
        "Color must be one of the predefined tag colors",
      );
    });
  });

  describe("isUniqueViolation", () => {
    it("returns true for objects with code 23505", () => {
      expect(isUniqueViolation({ code: "23505" })).toBe(true);
    });

    it("returns false for other error codes", () => {
      expect(isUniqueViolation({ code: "42000" })).toBe(false);
    });

    it("returns false for non-objects", () => {
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
      expect(isUniqueViolation("23505")).toBe(false);
    });

    it("returns false for objects without code", () => {
      expect(isUniqueViolation({})).toBe(false);
      expect(isUniqueViolation({ message: "error" })).toBe(false);
    });
  });
});
