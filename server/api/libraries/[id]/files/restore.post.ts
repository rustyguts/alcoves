import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const body = await readBody<{ fileIds: string[] }>(event);

  if (!body?.fileIds?.length) {
    throw createError({ statusCode: 400, statusMessage: "fileIds required" });
  }

  const restored = await db
    .update(schema.files)
    .set({ trashedAt: null })
    .where(and(eq(schema.files.libraryId, libraryId), inArray(schema.files.id, body.fileIds)))
    .returning({ id: schema.files.id });

  return { restored: restored.length };
});
