import { hashUserPassword, verifyUserPassword } from "~~/server/utils/auth";

describe("auth utils", () => {
  describe("hashUserPassword", () => {
    it("returns a bcrypt hash", async () => {
      const hash = await hashUserPassword("mysecretpassword");
      expect(hash).toMatch(/^\$2[aby]?\$\d{2}\$.{53}$/);
    });

    it("produces different hashes for the same password (salt)", async () => {
      const hash1 = await hashUserPassword("password");
      const hash2 = await hashUserPassword("password");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyUserPassword", () => {
    it("returns true for matching password and hash", async () => {
      const hash = await hashUserPassword("correct-password");
      expect(await verifyUserPassword("correct-password", hash)).toBe(true);
    });

    it("returns false for wrong password", async () => {
      const hash = await hashUserPassword("correct-password");
      expect(await verifyUserPassword("wrong-password", hash)).toBe(false);
    });
  });
});
