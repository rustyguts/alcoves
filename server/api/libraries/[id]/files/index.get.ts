import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);
  const showTrashed = query.trashed === "true";

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const trashFilter = showTrashed
    ? isNotNull(schema.files.trashedAt)
    : isNull(schema.files.trashedAt);

  return db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.libraryId, id), trashFilter));
});
