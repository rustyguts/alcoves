import { eq, count } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string; email: string; password: string }>(event);

  if (!body?.name?.trim() || !body?.email?.trim() || !body?.password) {
    throw createError({ statusCode: 400, statusMessage: "Name, email, and password are required" });
  }

  if (body.password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: "Password must be at least 8 characters" });
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, body.email.trim().toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: "Email already registered" });
  }

  // First user is owner, everyone else is member
  const [userCount] = await db.select({ value: count() }).from(schema.users);
  const role = userCount.value === 0 ? "owner" : "member";

  const passwordHash = await hashPassword(body.password);

  const [user] = await db
    .insert(schema.users)
    .values({
      email: body.email.trim().toLowerCase(),
      passwordHash,
      displayName: body.name.trim(),
      role,
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
    });

  // Create default library for the new user
  await db.insert(schema.libraries).values({
    name: "My Library",
    isDefault: true,
    ownerId: user.id,
  });

  // Set session
  const session = await getAuthSession(event);
  await session.update({ userId: user.id });

  return user;
});
