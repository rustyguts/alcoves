import { inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ fileIds?: string[] }>(event).catch(() => null);
  const ids = body?.fileIds ?? [fileId];

  const trashed = await db
    .update(schema.files)
    .set({ trashedAt: new Date() })
    .where(inArray(schema.files.id, ids))
    .returning();

  return { trashed: trashed.length };
});
