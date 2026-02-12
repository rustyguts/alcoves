import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<{ tags: LibraryTag[] }> => {
  const libraryId = getRouterParam(event, "id")!;
  const folderId = getRouterParam(event, "folderId")!;
  const body = await readBody<{ tagIds?: string[] }>(event);
  const uniqueTagIds = Array.from(new Set((body?.tagIds ?? []).filter(Boolean)));

  const [folder] = await db
    .select({ id: schema.folders.id })
    .from(schema.folders)
    .where(
      and(
        eq(schema.folders.id, folderId),
        eq(schema.folders.libraryId, libraryId),
        isNull(schema.folders.trashedAt),
      ),
    )
    .limit(1);
  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: "Folder not found" });
  }

  if (uniqueTagIds.length) {
    const tags = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.libraryId, libraryId), inArray(schema.tags.id, uniqueTagIds)));

    if (tags.length !== uniqueTagIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: "One or more tags do not belong to this library",
      });
    }
  }

  await db.delete(schema.folderTags).where(eq(schema.folderTags.folderId, folderId));

  if (uniqueTagIds.length) {
    await db.insert(schema.folderTags).values(
      uniqueTagIds.map((tagId) => ({
        folderId,
        tagId,
      })),
    );
  }

  const assignedTags = await db
    .select({
      id: schema.tags.id,
      libraryId: schema.tags.libraryId,
      name: schema.tags.name,
      color: schema.tags.color,
      createdAt: schema.tags.createdAt,
      updatedAt: schema.tags.updatedAt,
    })
    .from(schema.tags)
    .innerJoin(schema.folderTags, eq(schema.folderTags.tagId, schema.tags.id))
    .where(eq(schema.folderTags.folderId, folderId));

  return {
    tags: assignedTags
      .map((tag) => ({
        ...tag,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
});
