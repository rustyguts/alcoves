import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, getDescendantFolderIds } from "~~/server/domain/library/folders";
import { deleteFaceDataForFiles } from "~~/server/services/face-detection/cleanup";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const folderId = getRouterParam(event, "folderId")!;

  await assertFolderInLibrary(libraryId, folderId);

  const descendants = await getDescendantFolderIds(libraryId, folderId);
  const allFolderIds = [folderId, ...descendants];
  const trashedAt = new Date();
  const folderFiles = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        inArray(schema.files.parentFolderId, allFolderIds),
      ),
    );

  await deleteFaceDataForFiles(
    libraryId,
    folderFiles.map((file) => file.id),
  );

  await db
    .update(schema.files)
    .set({ trashedAt })
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        inArray(schema.files.parentFolderId, allFolderIds),
      ),
    );

  await db
    .update(schema.folders)
    .set({ trashedAt })
    .where(and(eq(schema.folders.libraryId, libraryId), inArray(schema.folders.id, allFolderIds)));

  return {
    deletedFolders: allFolderIds.length,
  };
});
