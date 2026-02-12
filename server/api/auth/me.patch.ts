import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  const session = await getUserSession(event);
  const body = await readBody<{ displayName?: string }>(event);

  const updates: Record<string, string> = {};
  if (body?.displayName?.trim()) {
    updates.displayName = body.displayName.trim();
  }

  if (Object.keys(updates).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No fields to update" });
  }

  const [updatedUser] = await db
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

  if (!updatedUser) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  // Update the session with fresh user data
  await setUserSession(event, {
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      role: updatedUser.role,
    },
    sessionToken: session.sessionToken,
  });

  return updatedUser;
});
