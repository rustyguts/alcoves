export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);

  // Delete database session record
  if (session?.sessionToken) {
    await deleteDbSession(session.sessionToken);
  }

  await clearUserSession(event);
  return { ok: true };
});
