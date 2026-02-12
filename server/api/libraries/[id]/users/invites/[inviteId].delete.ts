import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireCollaborativeLibraryAdmin } from "~~/server/domain/library/access";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const inviteId = getRouterParam(event, "inviteId")!;

  await requireCollaborativeLibraryAdmin(event, libraryId);

  const [invite] = await db
    .update(schema.libraryInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.libraryInvites.id, inviteId),
        eq(schema.libraryInvites.libraryId, libraryId),
        isNull(schema.libraryInvites.acceptedAt),
        isNull(schema.libraryInvites.revokedAt),
      ),
    )
    .returning({ id: schema.libraryInvites.id });

  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: "Invite not found" });
  }

  return { success: true };
});
