import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineNitroPlugin(() => {
  sessionHooks.hook("fetch", async (session, _event) => {
    if (!session.sessionToken) return;

    const dbSession = await validateDbSession(session.sessionToken);
    if (!dbSession) {
      // Session was revoked or expired — clear user data
      delete session.user;
      delete session.sessionToken;
      return;
    }

    const [dbUser] = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.id, dbSession.userId))
      .limit(1);

    if (!dbUser) {
      delete session.user;
      delete session.sessionToken;
      return;
    }

    session.user = dbUser;
  });

  sessionHooks.hook("clear", async (session, _event) => {
    if (session.sessionToken) {
      await deleteDbSession(session.sessionToken);
    }
  });
});
