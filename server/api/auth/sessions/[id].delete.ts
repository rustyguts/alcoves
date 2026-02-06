import { eq, and } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const userId = session.user.id;
  const sessionId = getRouterParam(event, "id");

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: "Session ID is required" });
  }

  // Find the session to make sure it belongs to this user
  const [dbSession] = await db
    .select({ id: schema.sessions.id, sessionToken: schema.sessions.sessionToken })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
    .limit(1);

  if (!dbSession) {
    throw createError({ statusCode: 404, statusMessage: "Session not found" });
  }

  // Prevent revoking the current session
  if (dbSession.sessionToken === session.sessionToken) {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot revoke the current session. Use logout instead.",
    });
  }

  await deleteDbSessionById(sessionId, userId);

  return { ok: true };
});
