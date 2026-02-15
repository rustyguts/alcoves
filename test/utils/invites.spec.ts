import { normalizeEmail, parseInviteRole, generateInviteToken } from "~~/server/utils/invites";

describe("invites utils", () => {
  describe("normalizeEmail", () => {
    it("trims and lowercases a valid email", () => {
      expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
    });

    it("throws 400 for non-string input", () => {
      expect(() => normalizeEmail(undefined)).toThrow();
      expect(() => normalizeEmail(null)).toThrow();
      expect(() => normalizeEmail(42)).toThrow();
    });

    it("throws 400 for empty string", () => {
      expect(() => normalizeEmail("")).toThrow();
      expect(() => normalizeEmail("   ")).toThrow();
    });

    it("throws 400 for invalid email format", () => {
      expect(() => normalizeEmail("not-an-email")).toThrow();
      expect(() => normalizeEmail("@no-local.com")).toThrow();
      expect(() => normalizeEmail("no-domain@")).toThrow();
    });

    it("accepts valid emails", () => {
      expect(normalizeEmail("a@b.c")).toBe("a@b.c");
      expect(normalizeEmail("user+tag@example.com")).toBe("user+tag@example.com");
    });
  });

  describe("parseInviteRole", () => {
    it("returns 'viewer' for undefined, null, or 'viewer'", () => {
      expect(parseInviteRole(undefined)).toBe("viewer");
      expect(parseInviteRole(null)).toBe("viewer");
      expect(parseInviteRole("viewer")).toBe("viewer");
    });

    it("returns 'admin' for 'admin'", () => {
      expect(parseInviteRole("admin")).toBe("admin");
    });

    it("throws for invalid roles", () => {
      expect(() => parseInviteRole("owner")).toThrow();
      expect(() => parseInviteRole("moderator")).toThrow();
      expect(() => parseInviteRole(123)).toThrow();
    });
  });

  describe("generateInviteToken", () => {
    it("returns a base64url string", () => {
      const token = generateInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThan(10);
    });

    it("generates unique tokens", () => {
      const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
      expect(tokens.size).toBe(50);
    });
  });
});
