import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireCollaborativeLibraryAdmin } from "~~/server/domain/library/access";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const memberUserId = getRouterParam(event, "memberUserId")!;
  const access = await requireCollaborativeLibraryAdmin(event, libraryId);
  const currentUserId = event.context.userId as string;

  if (memberUserId === access.ownerId) {
    throw createError({ statusCode: 400, statusMessage: "Cannot remove the library owner" });
  }

  if (memberUserId === currentUserId) {
    throw createError({ statusCode: 400, statusMessage: "You cannot remove yourself" });
  }

  const deleted = await db
    .delete(schema.libraryMembers)
    .where(
      and(
        eq(schema.libraryMembers.libraryId, libraryId),
        eq(schema.libraryMembers.userId, memberUserId),
      ),
    )
    .returning({ userId: schema.libraryMembers.userId });

  if (!deleted.length) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" });
  }

  return { success: true, userId: deleted[0]!.userId };
});
