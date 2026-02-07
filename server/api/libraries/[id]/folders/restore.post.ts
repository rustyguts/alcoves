import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, getDescendantFolderIds } from "~~/server/utils/folders";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const body = await readBody<{ folderIds?: string[] }>(event);
  const folderIds = Array.from(new Set((body?.folderIds ?? []).filter(Boolean)));

  if (!folderIds.length) {
    throw createError({ statusCode: 400, statusMessage: "folderIds required" });
  }

  const rootFolderIds: string[] = [];
  for (const folderId of folderIds) {
    const folder = await assertFolderInLibrary(libraryId, folderId, true);
    if (!folder.trashedAt) {
      continue;
    }
    rootFolderIds.push(folderId);
  }

  if (!rootFolderIds.length) {
    return { restoredFolders: 0, restoredFiles: 0 };
  }

  const folderSet = new Set<string>();
  for (const rootFolderId of rootFolderIds) {
    folderSet.add(rootFolderId);
    const descendants = await getDescendantFolderIds(libraryId, rootFolderId, true);
    descendants.forEach((id) => folderSet.add(id));
  }
  const allFolderIds = [...folderSet];

  const restoredFolders = await db
    .update(schema.folders)
    .set({ trashedAt: null })
    .where(
      and(
        eq(schema.folders.libraryId, libraryId),
        inArray(schema.folders.id, allFolderIds),
        isNotNull(schema.folders.trashedAt),
      ),
    )
    .returning({ id: schema.folders.id });

  const restoredFiles = await db
    .update(schema.files)
    .set({ trashedAt: null })
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        inArray(schema.files.parentFolderId, allFolderIds),
        isNotNull(schema.files.trashedAt),
      ),
    )
    .returning({ id: schema.files.id });

  return {
    restoredFolders: restoredFolders.length,
    restoredFiles: restoredFiles.length,
  };
});
