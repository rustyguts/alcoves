import { randomBytes } from "node:crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteRole = "admin" | "viewer";

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Email is required" });
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: "Valid email is required" });
  }

  return normalized;
}

export function parseInviteRole(input: unknown): InviteRole {
  if (input === undefined || input === null || input === "viewer") return "viewer";
  if (input === "admin") return "admin";
  throw createError({ statusCode: 400, statusMessage: "Invalid invite role" });
}

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}
