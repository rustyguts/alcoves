import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ name: string }>(event);

  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }

  const [library] = await db
    .update(schema.libraries)
    .set({ name: body.name.trim() })
    .where(eq(schema.libraries.id, id))
    .returning();

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  return library;
});
