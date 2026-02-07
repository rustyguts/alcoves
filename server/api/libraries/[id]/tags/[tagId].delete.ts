import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const tagId = getRouterParam(event, "tagId")!;

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const [deleted] = await db
    .delete(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.libraryId, libraryId)))
    .returning({ id: schema.tags.id });

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });
  }

  return { deleted: true };
});
