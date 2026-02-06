export default defineNitroPlugin(() => {
  sessionHooks.hook("fetch", async (session, _event) => {
    if (!session.sessionToken) return;

    const dbSession = await validateDbSession(session.sessionToken);
    if (!dbSession) {
      // Session was revoked or expired — clear user data
      delete session.user;
      delete session.sessionToken;
    }
  });

  sessionHooks.hook("clear", async (session, _event) => {
    if (session.sessionToken) {
      await deleteDbSession(session.sessionToken);
    }
  });
});
