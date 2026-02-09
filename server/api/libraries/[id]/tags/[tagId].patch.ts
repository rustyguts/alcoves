import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import {
  ensureTagBelongsToLibrary,
  isUniqueViolation,
  normalizeHexColor,
  normalizeTagName,
} from "~~/server/domain/library/tags";
import type { LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryTag> => {
  const libraryId = getRouterParam(event, "id")!;
  const tagId = getRouterParam(event, "tagId")!;
  const body = await readBody<{ name?: string; color?: string }>(event);

  const updates: Partial<typeof schema.tags.$inferInsert> = {};

  if (typeof body?.name === "string") {
    const name = normalizeTagName(body.name);
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: "Tag name cannot be empty" });
    }
    updates.name = name;
  }

  if (typeof body?.color === "string") {
    updates.color = normalizeHexColor(body.color);
  }

  if (!Object.keys(updates).length) {
    throw createError({ statusCode: 400, statusMessage: "No tag updates provided" });
  }

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  await ensureTagBelongsToLibrary(tagId, libraryId);

  try {
    const [tag] = await db
      .update(schema.tags)
      .set(updates)
      .where(and(eq(schema.tags.id, tagId), eq(schema.tags.libraryId, libraryId)))
      .returning();

    if (!tag) {
      throw createError({ statusCode: 404, statusMessage: "Tag not found" });
    }

    return {
      ...tag,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw createError({
      statusCode: 409,
      statusMessage: "Tag name or color is already in use",
    });
  }
});
