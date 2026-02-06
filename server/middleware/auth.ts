export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;

  // Skip auth for auth routes and non-API routes
  if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) return;

  const session = await getAuthSession(event);
  const userId = session.data.userId as string | undefined;

  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  event.context.userId = userId;
});
