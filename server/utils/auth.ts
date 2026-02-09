import type { H3Event } from "h3";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export function hashUserPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  });
}

export function verifyUserPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export async function requireUserId(event: H3Event): Promise<string> {
  const session = await requireUserSession(event);
  return session.user.id;
}

export async function requireOwner(event: H3Event): Promise<string> {
  const session = await requireUserSession(event);
  const userId = session.user.id;

  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user || user.role !== "owner") {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return userId;
}
