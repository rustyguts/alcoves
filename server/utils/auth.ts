import type { H3Event } from "h3";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

const SESSION_PASSWORD =
  process.env.ALCOVES_SESSION_SECRET || "alcoves-dev-secret-key-change-in-production!!";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getAuthSession(event: H3Event) {
  return useSession(event, { password: SESSION_PASSWORD });
}

export async function requireUserId(event: H3Event): Promise<string> {
  const session = await getAuthSession(event);
  const userId = session.data.userId as string | undefined;
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return userId;
}

export async function requireOwner(event: H3Event): Promise<string> {
  const userId = await requireUserId(event);

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
