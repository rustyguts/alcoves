import { inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ fileIds: string[] }>(event);

  if (!body?.fileIds?.length) {
    throw createError({ statusCode: 400, statusMessage: "fileIds required" });
  }

  const restored = await db
    .update(schema.files)
    .set({ trashedAt: null })
    .where(inArray(schema.files.id, body.fileIds))
    .returning();

  return { restored: restored.length };
});
