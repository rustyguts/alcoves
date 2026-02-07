import { asc, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { LibraryTag } from "~~/server/utils/types";

export default defineEventHandler(async (event): Promise<LibraryTag[]> => {
  const libraryId = getRouterParam(event, "id")!;

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const tags = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.libraryId, libraryId))
    .orderBy(asc(schema.tags.name));

  return tags.map((tag) => ({
    ...tag,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  }));
});
