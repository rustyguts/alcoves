import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~~/server/database";
import { verifyUserPassword } from "~~/server/utils/auth";
import { parseBodyWithSchema } from "~~/server/utils/validation";

const loginSchema = z.object({
  email: z.email("Email is required"),
  password: z.string().min(1, "Password is required"),
});

export default defineEventHandler(async (event) => {
  const body = await parseBodyWithSchema(event, loginSchema);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, body.email.trim().toLowerCase()))
    .limit(1);

  if (!user || !user.passwordHash) {
    throw createError({ statusCode: 401, statusMessage: "Invalid email or password" });
  }

  if (!(await verifyUserPassword(body.password, user.passwordHash))) {
    throw createError({ statusCode: 401, statusMessage: "Invalid email or password" });
  }

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

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
  };
});
