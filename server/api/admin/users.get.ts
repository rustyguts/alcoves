import { db, schema } from "~~/server/database";
import { requireOwner } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .orderBy(schema.users.createdAt);

  return users;
});
