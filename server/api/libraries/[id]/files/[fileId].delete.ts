import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ fileIds?: string[] }>(event).catch(() => null);
  const ids = body?.fileIds ?? [fileId];

  if (!ids.length) {
    return { trashed: 0 };
  }

  const trashed = await db
    .update(schema.files)
    .set({ trashedAt: new Date() })
    .where(and(eq(schema.files.libraryId, libraryId), inArray(schema.files.id, ids)))
    .returning({ id: schema.files.id });

  return { trashed: trashed.length };
});
