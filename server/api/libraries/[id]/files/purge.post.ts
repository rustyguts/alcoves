import { inArray, and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, getDescendantFolderIds } from "~~/server/domain/library/folders";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const storage = useStorageService();
  const body = await readBody<{ fileIds?: string[]; folderIds?: string[]; all?: boolean }>(event);

  let filesToDelete: { id: string; libraryId: string }[] = [];
  let folderIdsToDelete: string[] = [];

  if (body?.all) {
    // Purge all trashed files in this library
    filesToDelete = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(and(eq(schema.files.libraryId, libraryId), isNotNull(schema.files.trashedAt)));

    const foldersToDelete = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(and(eq(schema.folders.libraryId, libraryId), isNotNull(schema.folders.trashedAt)));
    folderIdsToDelete = foldersToDelete.map((folder) => folder.id);
  } else if (body?.folderIds?.length) {
    const folderSet = new Set<string>();
    for (const rootFolderId of body.folderIds) {
      await assertFolderInLibrary(libraryId, rootFolderId, true);
      folderSet.add(rootFolderId);
      const descendants = await getDescendantFolderIds(libraryId, rootFolderId, true);
      descendants.forEach((id) => folderSet.add(id));
    }
    folderIdsToDelete = [...folderSet];

    filesToDelete = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.libraryId, libraryId),
          inArray(schema.files.parentFolderId, folderIdsToDelete),
          isNotNull(schema.files.trashedAt),
        ),
      );
  } else if (body?.fileIds?.length) {
    // Purge specific files (must already be trashed)
    filesToDelete = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.libraryId, libraryId),
          inArray(schema.files.id, body.fileIds),
          isNotNull(schema.files.trashedAt),
        ),
      );
  } else {
    throw createError({ statusCode: 400, statusMessage: "fileIds, folderIds, or all required" });
  }

  for (const file of filesToDelete) {
    await storage.deleteFile(file.libraryId, file.id);
  }

  if (folderIdsToDelete.length > 0 && body?.all) {
    const filesInFolders = await db
      .select({ id: schema.files.id, libraryId: schema.files.libraryId })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.libraryId, libraryId),
          inArray(schema.files.parentFolderId, folderIdsToDelete),
        ),
      );

    const existingIds = new Set(filesToDelete.map((file) => file.id));
    for (const file of filesInFolders) {
      if (!existingIds.has(file.id)) {
        filesToDelete.push(file);
      }
    }
  }

  if (!filesToDelete.length && !folderIdsToDelete.length) return { deleted: 0 };

  const deleted =
    filesToDelete.length > 0
      ? await db
          .delete(schema.files)
          .where(
            and(
              eq(schema.files.libraryId, libraryId),
              inArray(
                schema.files.id,
                filesToDelete.map((f) => f.id),
              ),
            ),
          )
          .returning()
      : [];

  if (folderIdsToDelete.length > 0) {
    await db
      .delete(schema.folders)
      .where(
        and(eq(schema.folders.libraryId, libraryId), inArray(schema.folders.id, folderIdsToDelete)),
      );
  }

  return { deleted: deleted.length + folderIdsToDelete.length };
});
