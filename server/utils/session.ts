import type { H3Event } from "h3";
import { eq, and } from "drizzle-orm";
import { db, schema } from "~~/server/database";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createDbSession(userId: string, event: H3Event): Promise<string> {
  const sessionToken = crypto.randomUUID();
  const userAgent = getRequestHeader(event, "user-agent") || null;
  const ipAddress = getRequestIP(event, { xForwardedFor: true }) || null;

  await db.insert(schema.sessions).values({
    userId,
    sessionToken,
    userAgent,
    ipAddress,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
  });

  return sessionToken;
}

export async function deleteDbSession(sessionToken: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.sessionToken, sessionToken));
}

export async function deleteDbSessionById(sessionId: string, userId: string) {
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)));
}

export async function validateDbSession(sessionToken: string) {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.sessionToken, sessionToken))
    .limit(1);

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await deleteDbSession(sessionToken);
    return null;
  }

  return session;
}
