import { eq, count } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~~/server/database";
import { hashUserPassword } from "~~/server/utils/auth";
import { parseBodyWithSchema } from "~~/server/utils/validation";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.email("Email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export default defineEventHandler(async (event) => {
  const body = await parseBodyWithSchema(event, registerSchema);

  const email = body.email.trim().toLowerCase();

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw createError({ statusCode: 409, statusMessage: "Email already registered" });
  }

  // First user is owner, everyone else is member
  const [userCount] = await db.select({ value: count() }).from(schema.users);
  const role = userCount?.value === 0 ? "owner" : "member";

  const passwordHash = await hashUserPassword(body.password);

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      displayName: body.name,
      role,
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
    });

  if (!user) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create user" });
  }

  // Create credentials account record
  await db.insert(schema.accounts).values({
    userId: user.id,
    provider: "credentials",
    providerAccountId: email,
  });

  // Create default library for the new user
  await db.insert(schema.libraries).values({
    name: "My Library",
    isDefault: true,
    ownerId: user.id,
  });

  // Create database session and set cookie session
  const sessionToken = await createDbSession(user.id, event);
  await setUserSession(event, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
    },
    sessionToken,
  });

  return user;
});
