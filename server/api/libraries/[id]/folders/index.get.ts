import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { LibraryFolder, LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryFolder[]> => {
  const libraryId = getRouterParam(event, "id")!;

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const folders = await db
    .select()
    .from(schema.folders)
    .where(and(eq(schema.folders.libraryId, libraryId), isNull(schema.folders.trashedAt)))
    .orderBy(
      asc(sql<number>`case when ${schema.folders.parentFolderId} is null then 0 else 1 end`),
      asc(sql<string>`lower(${schema.folders.name})`),
      asc(schema.folders.id),
    );

  const folderIds = folders.map((folder) => folder.id);
  const folderTagRows = folderIds.length
    ? await db
        .select({
          folderId: schema.folderTags.folderId,
          id: schema.tags.id,
          libraryId: schema.tags.libraryId,
          name: schema.tags.name,
          color: schema.tags.color,
          createdAt: schema.tags.createdAt,
          updatedAt: schema.tags.updatedAt,
        })
        .from(schema.folderTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.folderTags.tagId))
        .where(inArray(schema.folderTags.folderId, folderIds))
    : [];

  const tagsByFolderId = new Map<string, LibraryTag[]>();
  for (const tagRow of folderTagRows) {
    const list = tagsByFolderId.get(tagRow.folderId) ?? [];
    list.push({
      id: tagRow.id,
      libraryId: tagRow.libraryId,
      name: tagRow.name,
      color: tagRow.color,
      createdAt: tagRow.createdAt.toISOString(),
      updatedAt: tagRow.updatedAt.toISOString(),
    });
    tagsByFolderId.set(tagRow.folderId, list);
  }

  return folders.map((folder) => ({
    id: folder.id,
    libraryId: folder.libraryId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    kind: "folder",
    trashedAt: folder.trashedAt ? folder.trashedAt.toISOString() : null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    tags: (tagsByFolderId.get(folder.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
});
