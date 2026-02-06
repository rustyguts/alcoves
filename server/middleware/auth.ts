export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Skip auth for non-API/non-IPX routes, and public auth routes
  const needsAuth = path.startsWith("/api/") || path.startsWith("/_ipx/");
  if (!needsAuth || path.startsWith("/api/auth/") || path.startsWith("/api/_auth/")) return;

  // TODO: Add authentication to image proxy route
  if (path.startsWith("/api/files/proxy/")) return;

  // getUserSession triggers the session fetch hook which validates the
  // session token against the database and clears revoked sessions.
  const session = await getUserSession(event);

  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  event.context.userId = session.user.id;
});
