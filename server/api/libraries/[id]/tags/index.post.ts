import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import {
  getNextUniqueTagColor,
  isUniqueViolation,
  normalizeTagName,
} from "~~/server/domain/library/tags";
import type { LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryTag> => {
  const libraryId = getRouterParam(event, "id")!;
  const body = await readBody<{ name?: string }>(event);
  const name = normalizeTagName(body?.name ?? "");

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "Tag name is required" });
  }

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const color = await getNextUniqueTagColor(libraryId);

  try {
    const inserted = await db
      .insert(schema.tags)
      .values({
        libraryId,
        name,
        color,
      })
      .returning();
    const tag = inserted[0];
    if (!tag) {
      throw createError({ statusCode: 500, statusMessage: "Failed to create tag" });
    }

    return {
      ...tag,
      createdAt: tag.createdAt.toISOString(),
      updatedAt: tag.updatedAt.toISOString(),
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw createError({ statusCode: 409, statusMessage: "Tag name already exists" });
  }
});
