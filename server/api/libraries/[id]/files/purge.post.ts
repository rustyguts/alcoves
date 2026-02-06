import { inArray, and, isNotNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileIds: string[] }>(event);

  if (!body?.fileIds?.length) {
    throw createError({ statusCode: 400, statusMessage: "fileIds required" });
  }

  // Only purge files that are already trashed
  const filesToDelete = await db
    .select({ id: schema.files.id, libraryId: schema.files.libraryId })
    .from(schema.files)
    .where(and(inArray(schema.files.id, body.fileIds), isNotNull(schema.files.trashedAt)));

  for (const file of filesToDelete) {
    await deleteFileFromDisk(file.libraryId, file.id);
  }

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
