import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~~/server/database";
import { parseBodyWithSchema } from "~~/server/utils/validation";

const updateUserRoleSchema = z.object({
  role: z.enum(["owner", "member"]),
});

export default defineEventHandler(async (event) => {
  const currentOwnerId = await requireOwner(event);
  const userId = getRouterParam(event, "userId")!;
  const body = await parseBodyWithSchema(event, updateUserRoleSchema);

  if (userId === currentOwnerId) {
    throw createError({ statusCode: 400, statusMessage: "You cannot change your own role" });
  }

  const [targetUser] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!targetUser) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  if (targetUser.role === body.role) {
    return { id: targetUser.id, role: targetUser.role };
  }

  if (targetUser.role === "owner" && body.role === "member") {
    const [ownerCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(and(eq(schema.users.role, "owner"), ne(schema.users.id, targetUser.id)));
    const remainingOwnerCount = Number(ownerCountRow?.count ?? 0);
    if (remainingOwnerCount < 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot remove the last owner",
      });
    }
  }

  const [updated] = await db
    .update(schema.users)
    .set({ role: body.role })
    .where(eq(schema.users.id, userId))
    .returning({
      id: schema.users.id,
      role: schema.users.role,
      updatedAt: schema.users.updatedAt,
    });

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  return {
    id: updated.id,
    role: updated.role,
    updatedAt: updated.updatedAt.toISOString(),
  };
});
