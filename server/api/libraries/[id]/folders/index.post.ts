import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";
import type { LibraryFolder } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryFolder> => {
  const libraryId = getRouterParam(event, "id")!;
  const body = await readBody<{ name?: string; parentFolderId?: string | null }>(event);
  const name = body?.name?.trim();

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const parentFolderId = normalizeFolderId(body?.parentFolderId);
  if (parentFolderId) {
    await assertFolderInLibrary(libraryId, parentFolderId);
  }

  const [folder] = await db
    .insert(schema.folders)
    .values({
      libraryId,
      parentFolderId,
      name,
    })
    .returning();

  if (!folder) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create folder" });
  }

  return {
    id: folder.id,
    libraryId: folder.libraryId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    kind: "folder",
    trashedAt: folder.trashedAt ? folder.trashedAt.toISOString() : null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    tags: [],
  };
});
