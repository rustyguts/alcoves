import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ name: string }>(event);

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }

  const [file] = await db
    .update(schema.files)
    .set({ name: body.name.trim() })
    .where(eq(schema.files.id, fileId))
    .returning();

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  return file;
});
