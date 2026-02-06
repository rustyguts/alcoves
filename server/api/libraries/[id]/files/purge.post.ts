import { inArray, and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const body = await readBody<{ fileIds?: string[]; all?: boolean }>(event);

  let filesToDelete;

  if (body?.all) {
    // Purge all trashed files in this library
    filesToDelete = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(and(eq(schema.files.libraryId, libraryId), isNotNull(schema.files.trashedAt)));
  } else if (body?.fileIds?.length) {
    // Purge specific files (must already be trashed)
    filesToDelete = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(and(inArray(schema.files.id, body.fileIds), isNotNull(schema.files.trashedAt)));
  } else {
    throw createError({ statusCode: 400, statusMessage: "fileIds or all required" });
  }

  for (const file of filesToDelete) {
    await deleteFileFromDisk(file.libraryId, file.id);
  }

  if (!filesToDelete.length) return { deleted: 0 };

  const deleted = await db
    .delete(schema.files)
    .where(
      inArray(
        schema.files.id,
        filesToDelete.map((f) => f.id),
      ),
    )
    .returning();

  return { deleted: deleted.length };
});
