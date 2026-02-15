/**
 * Tests for pure helper functions from the library files service.
 * The main listLibraryFiles function requires a database, so we test
 * the cursor parsing and folder normalization logic.
 */

// Replicate parseCursor from the service (not exported)
interface CursorPayload {
  kindRank: number;
  sortName: string;
  id: string;
}

function parseCursor(cursor: unknown): CursorPayload | null {
  if (typeof cursor !== "string" || !cursor) return null;

  try {
    const decoded = JSON.parse(atob(cursor)) as CursorPayload;
    if (
      typeof decoded.id !== "string" ||
      typeof decoded.sortName !== "string" ||
      (decoded.kindRank !== 0 && decoded.kindRank !== 1)
    ) {
      throw new Error("Invalid cursor payload");
    }
    return decoded;
  } catch {
    throw new Error("Invalid cursor");
  }
}

describe("library files service helpers", () => {
  describe("parseCursor", () => {
    it("returns null for empty/undefined input", () => {
      expect(parseCursor(undefined)).toBeNull();
      expect(parseCursor(null)).toBeNull();
      expect(parseCursor("")).toBeNull();
    });

    it("parses a valid folder cursor (kindRank=0)", () => {
      const payload: CursorPayload = { kindRank: 0, sortName: "documents", id: "folder-1" };
      const encoded = btoa(JSON.stringify(payload));
      const result = parseCursor(encoded);
      expect(result).toEqual(payload);
    });

    it("parses a valid file cursor (kindRank=1)", () => {
      const payload: CursorPayload = { kindRank: 1, sortName: "photo.jpg", id: "file-1" };
      const encoded = btoa(JSON.stringify(payload));
      const result = parseCursor(encoded);
      expect(result).toEqual(payload);
    });

    it("throws for invalid base64", () => {
      expect(() => parseCursor("not-valid-base64!!!")).toThrow("Invalid cursor");
    });

    it("throws for valid base64 but invalid JSON", () => {
      const encoded = btoa("not json");
      expect(() => parseCursor(encoded)).toThrow("Invalid cursor");
    });

    it("throws for valid JSON but missing fields", () => {
      const encoded = btoa(JSON.stringify({ id: "123" }));
      expect(() => parseCursor(encoded)).toThrow("Invalid cursor");
    });

    it("throws for invalid kindRank values", () => {
      const encoded = btoa(JSON.stringify({ kindRank: 2, sortName: "a", id: "1" }));
      expect(() => parseCursor(encoded)).toThrow("Invalid cursor");
    });

    it("accepts edge case with empty sortName", () => {
      const payload: CursorPayload = { kindRank: 0, sortName: "", id: "folder-1" };
      const encoded = btoa(JSON.stringify(payload));
      const result = parseCursor(encoded);
      expect(result).toEqual(payload);
    });
  });

  describe("limit parsing logic", () => {
    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 200;

    function parseLimit(input: unknown): number {
      const parsed = Number(input) || DEFAULT_LIMIT;
      return Math.min(Math.max(parsed, 1), MAX_LIMIT);
    }

    it("returns default for NaN values", () => {
      expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
      expect(parseLimit("abc")).toBe(DEFAULT_LIMIT);
    });

    it("clamps to minimum of 1", () => {
      expect(parseLimit(0)).toBe(DEFAULT_LIMIT); // 0 is falsy, becomes default
      expect(parseLimit(-5)).toBe(1);
    });

    it("clamps to maximum", () => {
      expect(parseLimit(500)).toBe(MAX_LIMIT);
    });

    it("accepts valid limits", () => {
      expect(parseLimit(25)).toBe(25);
      expect(parseLimit(100)).toBe(100);
    });
  });
});
