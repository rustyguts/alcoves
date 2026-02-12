import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<{ tags: LibraryTag[] }> => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ tagIds?: string[] }>(event);
  const uniqueTagIds = Array.from(new Set((body?.tagIds ?? []).filter(Boolean)));

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);
  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const [file] = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
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

  await db.delete(schema.fileTags).where(eq(schema.fileTags.fileId, fileId));

  if (uniqueTagIds.length) {
    await db.insert(schema.fileTags).values(
      uniqueTagIds.map((tagId) => ({
        fileId,
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
    .innerJoin(schema.fileTags, eq(schema.fileTags.tagId, schema.tags.id))
    .where(eq(schema.fileTags.fileId, fileId));

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
