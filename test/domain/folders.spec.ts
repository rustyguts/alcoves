import { normalizeFolderId } from "~~/server/domain/library/folders";

describe("folder domain utils", () => {
  describe("normalizeFolderId", () => {
    it("returns null for non-string input", () => {
      expect(normalizeFolderId(undefined)).toBeNull();
      expect(normalizeFolderId(null)).toBeNull();
      expect(normalizeFolderId(42)).toBeNull();
      expect(normalizeFolderId({})).toBeNull();
    });

    it("returns null for empty or whitespace-only strings", () => {
      expect(normalizeFolderId("")).toBeNull();
      expect(normalizeFolderId("   ")).toBeNull();
    });

    it("returns null for the literal string 'null'", () => {
      expect(normalizeFolderId("null")).toBeNull();
    });

    it("trims and returns valid folder IDs", () => {
      expect(normalizeFolderId("folder-123")).toBe("folder-123");
      expect(normalizeFolderId("  folder-123  ")).toBe("folder-123");
    });

    it("returns the string for any non-empty value", () => {
      expect(normalizeFolderId("abc")).toBe("abc");
      expect(normalizeFolderId("0")).toBe("0");
    });
  });
});
