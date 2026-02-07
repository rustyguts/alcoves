import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { parseInviteRole } from "~~/server/utils/invites";
import { requireCollaborativeLibraryAdmin } from "~~/server/utils/libraries";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const memberUserId = getRouterParam(event, "memberUserId")!;
  const access = await requireCollaborativeLibraryAdmin(event, libraryId);
  const body = await readBody<{ role?: "admin" | "viewer" }>(event);
  const role = parseInviteRole(body?.role);

  if (memberUserId === access.ownerId) {
    throw createError({ statusCode: 400, statusMessage: "Cannot change owner access" });
  }

  const [member] = await db
    .update(schema.libraryMembers)
    .set({ role })
    .where(
      and(
        eq(schema.libraryMembers.libraryId, libraryId),
        eq(schema.libraryMembers.userId, memberUserId),
      ),
    )
    .returning({
      id: schema.libraryMembers.id,
      userId: schema.libraryMembers.userId,
      role: schema.libraryMembers.role,
      createdAt: schema.libraryMembers.createdAt,
      updatedAt: schema.libraryMembers.updatedAt,
    });

  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" });
  }

  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
});
