import { eq, count } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event);
  const id = getRouterParam(event, "id")!;

  const [library] = await db
    .select()
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  if (library.ownerId !== userId) {
    throw createError({ statusCode: 403, statusMessage: "Only the library owner can delete it" });
  }

  if (library.isDefault) {
    throw createError({ statusCode: 400, statusMessage: "Cannot delete your default library" });
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.files)
    .where(eq(schema.files.libraryId, id));

  if (total > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Library must be empty before it can be deleted",
    });
  }

  await db.delete(schema.libraries).where(eq(schema.libraries.id, id));

  return { success: true };
});
