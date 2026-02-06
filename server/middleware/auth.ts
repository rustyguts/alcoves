export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Skip auth for non-API/non-IPX routes, and public auth routes
  const needsAuth = path.startsWith("/api/") || path.startsWith("/_ipx/");
  if (!needsAuth || path.startsWith("/api/auth/")) return;

  const session = await getAuthSession(event);
  const userId = session.data.userId as string | undefined;

  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  event.context.userId = userId;
});
