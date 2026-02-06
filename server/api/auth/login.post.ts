import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email: string; password: string }>(event);

  if (!body?.email?.trim() || !body?.password) {
    throw createError({ statusCode: 400, statusMessage: "Email and password are required" });
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, body.email.trim().toLowerCase()))
    .limit(1);

  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: "Invalid email or password" });
  }

  const session = await getAuthSession(event);
  await session.update({ userId: user.id });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
});
