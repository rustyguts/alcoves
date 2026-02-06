import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireUserId } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  const body = await readBody<{ displayName?: string; avatarUrl?: string }>(event);

  const updates: Record<string, string> = {};
  if (body?.displayName?.trim()) {
    updates.displayName = body.displayName.trim();
  }
  if (body?.avatarUrl !== undefined) {
    updates.avatarUrl = body.avatarUrl;
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No fields to update" });
  }

  const [user] = await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId))
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
    });

  return user;
});
