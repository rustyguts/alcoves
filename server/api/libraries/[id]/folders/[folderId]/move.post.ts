import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertMoveParentValid, normalizeFolderId } from "~~/server/utils/folders";
import type { LibraryFolder } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryFolder> => {
  const libraryId = getRouterParam(event, "id")!;
  const folderId = getRouterParam(event, "folderId")!;
  const body = await readBody<{ parentFolderId?: string | null }>(event);
  const parentFolderId =
    body && "parentFolderId" in body ? normalizeFolderId(body.parentFolderId) : null;

  await assertMoveParentValid(libraryId, folderId, parentFolderId);

  const [folder] = await db
    .update(schema.folders)
    .set({ parentFolderId })
    .where(
      and(
        eq(schema.folders.id, folderId),
        eq(schema.folders.libraryId, libraryId),
        isNull(schema.folders.trashedAt),
      ),
    )
    .returning();

  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: "Folder not found" });
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
