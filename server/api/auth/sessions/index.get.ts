import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const userId = session.user.id;
  const currentToken = session.sessionToken;

  const dbSessions = await db
    .select({
      id: schema.sessions.id,
      userAgent: schema.sessions.userAgent,
      ipAddress: schema.sessions.ipAddress,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
      sessionToken: schema.sessions.sessionToken,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .orderBy(schema.sessions.createdAt);

  return dbSessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.sessionToken === currentToken,
  }));
});
